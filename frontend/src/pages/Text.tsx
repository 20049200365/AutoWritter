/* 正文：阅读态 + Tiptap 编辑态 + 划选改写对照卡片 + 版本留档（对齐参考模板模块 3） */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { api, Chapter, CH_STATUS, fmtCh, OutlineNode, Project, sseStream } from '../api'
import { emit } from '../bus'
import { Empty, Modal, ToastMsg } from '../ui'

const OPS = ['润色', '精简', '扩写', '改人称'] as const

export default function TextPage({ project, onChanged, toast, initialChapter, jumpSeq }: {
  project: Project; onChanged: () => void; toast: (t: ToastMsg) => void
  initialChapter?: number; jumpSeq?: number
}) {
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [outline, setOutline] = useState<OutlineNode[]>([])
  const [curId, setCurId] = useState<number | null>(null)
  const [mode, setMode] = useState<'read' | 'edit'>('read')

  const load = useCallback(async () => {
    const [cs, os] = await Promise.all([
      api.get<Chapter[]>(`/projects/${project.id}/chapters`),
      api.get<OutlineNode[]>(`/projects/${project.id}/outline`),
    ])
    cs.sort((a, b) => a.seq - b.seq)
    setChapters(cs)
    setOutline(os)
    setCurId((cur) => cur ?? cs[0]?.id ?? null)
  }, [project.id])
  useEffect(() => { load() }, [load])

  const cur = chapters.find((c) => c.id === curId) || null
  const idx = chapters.findIndex((c) => c.id === curId)
  const written = chapters.filter((c) => c.word_count > 0).length

  /* 命令面板 / 时间线跳章（App 级 jump 传参） */
  useEffect(() => {
    if (initialChapter != null) { setCurId(initialChapter); setMode('read') }
  }, [initialChapter, jumpSeq])

  /* 专注模式：隐藏书架/上下文栏/页签（对齐参考模板） */
  const [focus, setFocus] = useState(false)
  useEffect(() => {
    document.body.classList.toggle('focus', focus)
    return () => document.body.classList.remove('focus')
  }, [focus])
  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') setFocus(false) }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [])

  // 当前章挂载的卷名（卷→…→节点链上的 level1 标题）
  const volTag = useMemo(() => {
    if (!cur?.outline_node_id) return ''
    let n = outline.find((x) => x.id === cur.outline_node_id)
    while (n && n.parent_id != null && n.level > 1) n = outline.find((x) => x.id === n!.parent_id)
    return n && n.level === 1 ? n.title : ''
  }, [cur, outline])

  async function newChapter() {
    const ch = await api.post<Chapter>('/chapters', {
      project_id: project.id, title: `第${chapters.length + 1}章`,
    })
    await load(); setCurId(ch.id); onChanged()
  }

  return (
    <div className="split">
      {/* 章目录（上下文栏） */}
      <aside id="colCtx">
        <div className="ctx-hd">
          <h4>章 节</h4>
          <span className="dim mono">{written} 篇已写</span>
        </div>
        <div className="ctx-body">
          {chapters.map((c) => (
            <button key={c.id} className={`row${c.id === curId ? ' on' : ''}`}
              onClick={() => { setCurId(c.id); setMode('read') }}>
              <span className="ch-no">{fmtCh(c.seq)}</span>
              <span className="r-main">
                <span className="r-t">{c.title}</span>
                <span className="r-s">{c.word_count.toLocaleString()} 字 · {c.status}</span>
              </span>
            </button>
          ))}
          {chapters.length === 0 && <Empty text="尚未落笔" actionText="开第一章" onAction={newChapter} />}
          <div style={{ padding: '8px 10px' }}>
            <button className="btn sm" onClick={newChapter}>＋ 开新章</button>
          </div>
        </div>
      </aside>

      {/* 正文区 */}
      <div className="col-main-inner">
        {focus && (
          <button className="btn sm focus-exit" onClick={() => setFocus(false)}>退出专注</button>
        )}
        {cur ? (
          <>
            <div className="text-top">
              {volTag && <span className="vol-tag">{volTag}</span>}
              <h2>{fmtCh(cur.seq)} · {cur.title}</h2>
              <div className="seg">
                <button className={mode === 'read' ? 'on' : ''} onClick={() => setMode('read')}>阅读</button>
                <button className={mode === 'edit' ? 'on' : ''} onClick={() => setMode('edit')}>编辑</button>
              </div>
              <span className="meta">
                {cur.word_count.toLocaleString()} 字 · {cur.status}
                <ChapterActions chapter={cur} outline={outline} onChanged={async () => { await load(); onChanged() }} />
                {mode === 'read'
                  ? <button className="btn sm ghost" onClick={() => setFocus(true)}>专注阅读</button>
                  : <button className="btn sm ghost" onClick={() => setFocus(true)}>专注</button>}
              </span>
            </div>
            <div className="prose-scroll">
              {mode === 'read' ? (
                cur.text ? <ReadView chapter={cur} /> : (
                  /* 空章态：大纲节拍 + 起草入口（对齐参考模板） */
                  <div className="prose">
                    <Empty text="本章尚无正文" />
                    {cur.plan && (
                      <div className="card" style={{ marginTop: 14, padding: 14 }}>
                        <h3 style={{ fontSize: 13 }}>细纲</h3>
                        <p className="kai" style={{ whiteSpace: 'pre-wrap', marginTop: 6, textIndent: 0 }}>{cur.plan}</p>
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 14 }}>
                      <button className="btn primary" onClick={() => {
                        const beat = (cur.plan || outline.find((n) => n.id === cur.outline_node_id)?.summary || '（暂无节拍）').replace(/[。！？；]+$/, '')
                        emit('ns:pending-chat',
                          `请为《${project.title}》起草 ${fmtCh(cur.seq)}「${cur.title}」。本章节拍：${beat}。请按 ${project.genre} 的声口、${project.pov || '第三人称'}写。`)
                        toast({ text: '起草指令已带入对话输入框，去 Agent 对话页落笔' })
                      }}>✦ 让 Agent 起草本章</button>
                      <button className="btn" onClick={() => setMode('edit')}>✎ 我自己写</button>
                    </div>
                  </div>
                )
              ) : (
                <EditView key={cur.id} chapter={cur} toast={toast}
                  onSaved={async () => { await load(); onChanged() }} />
              )}
            </div>
            <div className="pager">
              <button className="btn sm" disabled={idx <= 0}
                onClick={() => setCurId(chapters[idx - 1].id)}>← 上一章</button>
              <span className="pos">{fmtCh(cur.seq)} · {idx + 1}/{chapters.length}</span>
              <button className="btn sm" disabled={idx >= chapters.length - 1}
                onClick={() => setCurId(chapters[idx + 1].id)}>下一章 →</button>
            </div>
          </>
        ) : (
          <Empty text="先开一章" actionText="开第一章" onAction={newChapter} />
        )}
      </div>
    </div>
  )
}

function ChapterActions({ chapter, outline, onChanged }: {
  chapter: Chapter; outline: OutlineNode[]; onChanged: () => Promise<void>
}) {
  const leaves = outline.filter((n) => n.level >= 2)
  const si = CH_STATUS.indexOf(chapter.status)

  async function cycle() {
    await api.patch(`/chapters/${chapter.id}`, { status: CH_STATUS[(si + 1) % CH_STATUS.length] })
    await onChanged()
  }
  async function mount(nodeId: string) {
    await api.patch(`/chapters/${chapter.id}`, { outline_node_id: nodeId === '' ? null : +nodeId })
    await onChanged()
  }
  return (
    <>
      <select className="select" style={{ width: 150 }} value={chapter.outline_node_id ?? ''}
        onChange={(e) => mount(e.target.value)} title="挂载大纲节点">
        <option value="">未挂载大纲</option>
        {leaves.map((n) => <option key={n.id} value={n.id}>{n.title}</option>)}
      </select>
      <button className="tag seal" onClick={cycle} title="点击循环状态">{chapter.status}</button>
    </>
  )
}

/* ---------- 阅读态 ---------- */
function ReadView({ chapter }: { chapter: Chapter }) {
  const paras = useMemo(() => (chapter.text || '').split(/\n+/).filter(Boolean), [chapter.text])
  return (
    <div className="prose">
      {paras.map((p, i) => <p key={i}>{p}</p>)}
    </div>
  )
}

/* ---------- 编辑态：Tiptap + 划选改写 ---------- */
function EditView({ chapter, toast, onSaved }: {
  chapter: Chapter; toast: (t: ToastMsg) => void; onSaved: () => Promise<void>
}) {
  const [saving, setSaving] = useState(false)
  const [title, setTitle] = useState(chapter.title)
  const [selBar, setSelBar] = useState<{ x: number; y: number; from: number; to: number } | null>(null)
  const [diff, setDiff] = useState<{ original: string; result: string; from: number; to: number } | null>(null)

  const editor = useEditor({
    extensions: [StarterKit],
    content: (chapter.text || '').split(/\n+/).filter(Boolean).map((p) => `<p>${p}</p>`).join(''),
    onUpdate: () => setSelBar(null),
  })

  useEffect(() => {
    const fn = () => {
      if (!editor) return
      const { from, to } = editor.state.selection
      if (from === to) { setSelBar(null); return }
      const coords = editor.view.coordsAtPos(from)
      const box = editor.view.dom.getBoundingClientRect()
      setSelBar({ x: coords.left - box.left, y: coords.top - box.top - 40, from, to })
    }
    const t = setInterval(fn, 400)
    return () => clearInterval(t)
  }, [editor])

  async function save() {
    if (!editor) return
    setSaving(true)
    const text = editor.getText({ blockSeparator: '\n' })
    if (title.trim() && title !== chapter.title) {
      await api.patch(`/chapters/${chapter.id}`, { title: title.trim() })
    }
    await api.post(`/chapters/${chapter.id}/commit`, { text, source: 'human' })
    setSaving(false)
    toast({ text: '已保存为新版本' })
    await onSaved()
  }

  async function runRewrite(op: string) {
    if (!editor || !selBar) return
    const original = editor.state.doc.textBetween(selBar.from, selBar.to, '\n')
    setSelBar(null)
    try {
      let result = ''
      for await (const ev of sseStream(`/chapters/${chapter.id}/rewrite`, {
        start: selBar.from - 1, end: selBar.to - 1, op,
      })) {
        if (ev.event === 'done') { result = ev.data.result }
      }
      setDiff({ original, result, from: selBar.from, to: selBar.to })
    } catch (e: any) {
      toast({ text: `改写失败：${e.message}` })
    }
  }

  function acceptDiff() {
    if (!editor || !diff) return
    editor.chain().focus()
      .deleteRange({ from: diff.from, to: diff.to })
      .insertContentAt(diff.from, diff.result)
      .run()
    setDiff(null)
  }

  if (!editor) return null
  const liveCount = editor.getText().replace(/\s/g, '').length

  return (
    <div className="edit-wrap" style={{ position: 'relative' }}>
      <input className="edit-title" value={title} placeholder="章题"
        onChange={(e) => setTitle(e.target.value)} />
      {selBar && !diff && (
        <div className="selbar" style={{ left: selBar.x, top: selBar.y }}>
          {OPS.map((op) => <button key={op} onClick={() => runRewrite(op)}>{op}</button>)}
          <button onClick={() => setSelBar(null)}>✕</button>
        </div>
      )}

      {diff && (
        <div className="card diffcard">
          <div className="dc-lb"><b>AI 改写对照</b><span className="dim">左原右新，采纳后替换选中段</span></div>
          <div className="dc-row">
            <div className="dc-cell">{diff.original}</div>
            <div className="dc-cell after">{diff.result}</div>
          </div>
          <div className="dc-acts">
            <button className="btn sm" onClick={() => setDiff(null)}>放弃</button>
            <button className="btn sm" onClick={() => runRewrite('润色')}>再来一次</button>
            <button className="btn sm primary" onClick={acceptDiff}>采纳替换</button>
          </div>
        </div>
      )}

      <div className="edit-status">
        <button className="btn primary sm" disabled={saving} onClick={save}>{saving ? '保存中…' : '保存（留版本）'}</button>
        <span className="mono">编辑区 {liveCount} 字</span>
        <span className="dim">章总字数以保存后为准</span>
      </div>
      <div className="edit-shell">
        <EditorContent editor={editor} />
      </div>
    </div>
  )
}
