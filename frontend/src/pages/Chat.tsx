/* Agent 对话（对齐参考模板模块 2）：会话上下文栏 + 工具卡片状态机 + 快捷指令 + 停止生成
   数据流严格消费 M6 契约：POST /sessions/{id}/chat SSE（tool_call/tool_result/token/done） */
import { useEffect, useRef, useState } from 'react'
import { api, mdToHtml, Project, Session, sseStream, Stats, stripMd } from '../api'
import { on } from '../bus'
import { Empty } from '../ui'

interface Tool { name: string; args?: string; result?: string; done: boolean; open: boolean }
interface Msg {
  role: 'user' | 'assistant'; content: string
  tools?: Tool[]; thinking?: string[]; streaming?: boolean
}

const CHIPS = [
  { q: '接着写下一章', t: '续写下一章' },
  { q: '把所有伏笔的埋收状态理一遍', t: '梳理伏笔' },
  { q: '诊断一下大纲节奏', t: '诊断节奏' },
  { q: '分析主要人物的动机', t: '人物分析' },
  { q: '我有点卡文了', t: '卡文疏导' },
  { q: '给未定名的角色取名', t: '取名' },
]

export default function ChatPage({ project, stats, onChanged, initialSession, jumpSeq }: {
  project: Project; stats: Stats | null; onChanged?: () => void
  initialSession?: number; jumpSeq?: number
}) {
  const [sessions, setSessions] = useState<Session[]>([])
  const [sid, setSid] = useState<number | null>(null)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')
  const boxRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const sidRef = useRef<number | null>(null)
  sidRef.current = sid

  const loadSessions = () =>
    api.get<Session[]>(`/projects/${project.id}/sessions`).then((ss) => {
      setSessions(ss)
      setSid((cur) => cur ?? ss[ss.length - 1]?.id ?? null)
    })
  useEffect(() => {
    setSid(null); setMsgs([])
    loadSessions()
  }, [project.id])   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (sid == null) { setMsgs([]); return }
    api.get<any[]>(`/sessions/${sid}/messages`).then((ms) =>
      setMsgs(ms.filter((m) => m.role === 'user' || m.role === 'assistant').map((m) => ({
        role: m.role, content: m.content || '',
        // 历史消息的工具卡必须「完成」态且可展开（E9）
        tools: (m.tool_calls || []).map((t: any) => ({
          name: t.name || '工具', args: t.args, result: t.result, done: true, open: false,
        })),
        thinking: m.thinking || undefined,
      }))))
  }, [sid])

  useEffect(() => {
    boxRef.current?.scrollTo({ top: boxRef.current.scrollHeight })
  }, [msgs])

  /* 正文页「让 Agent 起草本章」把指令带入输入框（bus 滞留消费） */
  useEffect(() => on('ns:pending-chat', (text: string) => {
    setInput(text)
    setTimeout(() => {
      taRef.current?.focus()
      if (taRef.current) taRef.current.style.height = Math.min(150, taRef.current.scrollHeight) + 'px'
    }, 0)
  }), [])
  /* 命令面板跳转会话（App 级 jump 传参） */
  useEffect(() => {
    if (initialSession != null) setSid(initialSession)
  }, [initialSession, jumpSeq])

  async function newSession(firstText?: string) {
    const s = await api.post<Session>('/sessions', {
      project_id: project.id,
      title: firstText ? (stripMd(firstText).slice(0, 22) || '新会话') : '新会话',
    })
    setSessions((cur) => [...cur, s])
    setSid(s.id)
    return s
  }

  async function delSession(id: number) {
    await api.del(`/sessions/${id}`)
    setSessions((cur) => cur.filter((s) => s.id !== id))
    if (sidRef.current === id) setSid(null)
    onChanged?.()
  }

  function patchLastAi(fn: (ai: Msg) => void) {
    setMsgs((cur) => {
      const next = [...cur]
      const ai = { ...next[next.length - 1] }
      fn(ai)
      next[next.length - 1] = ai
      return next
    })
  }

  async function send(text?: string) {
    const t = (text ?? input).trim()
    if (!t || busy) return
    setInput('')
    if (taRef.current) taRef.current.style.height = 'auto'
    let target = sidRef.current
    if (target == null) target = (await newSession(t)).id
    setBusy(true)
    setMsgs((cur) => [...cur,
      { role: 'user', content: t },
      { role: 'assistant', content: '', tools: [], streaming: true }])
    const ctrl = new AbortController()
    abortRef.current = ctrl
    try {
      for await (const ev of sseStream(`/sessions/${target}/chat`, { text: t }, ctrl.signal)) {
        const d = ev.data || {}
        if (ev.event === 'tool_call') {
          patchLastAi((ai) => ai.tools = [...(ai.tools || []),
            { name: d.name, args: d.args, done: d.status === 'done', open: false }])
        } else if (ev.event === 'tool_result') {
          patchLastAi((ai) => ai.tools = (ai.tools || []).map((x) =>
            x.name === d.name && !x.done ? { ...x, result: d.result, done: true } : x))
        } else if (ev.event === 'token') {
          patchLastAi((ai) => { ai.content += d.delta })
        } else if (ev.event === 'done') {
          patchLastAi((ai) => { ai.streaming = false })
        }
      }
    } catch (e: any) {
      const aborted = e?.name === 'AbortError'
      patchLastAi((ai) => {
        ai.streaming = false
        ai.tools = (ai.tools || []).map((x) => ({ ...x, done: true }))
        if (aborted) ai.content += '\n\n（已停止生成，以上为已产出内容。）'
        else ai.content += `\n\n（出错：${e.message}）`
      })
    }
    abortRef.current = null
    setBusy(false)
    loadSessions()
    onChanged?.()
  }

  function stop() {
    abortRef.current?.abort()
  }

  const shown = query ? sessions.filter((s) => (s.title || '').includes(query)) : sessions
  const cur = sessions.find((s) => s.id === sid) || null

  return (
    <div className="split">
      {/* ---------- 会话上下文栏 ---------- */}
      <aside id="colCtx">
        <div className="ctx-hd">
          <h4>会 话</h4>
          <button className="icon-btn" title="新建会话" onClick={() => newSession()}>✚</button>
        </div>
        <div className="ctx-search">
          <input placeholder="搜索会话…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="ctx-body">
          {shown.length === 0 ? (
            <Empty text={query ? '没有匹配的会话' : '还没有会话'}
              actionText={query ? undefined : '开始第一段对话'} onAction={() => newSession()} />
          ) : [...shown].sort((a, b) => (b.updated_at || b.created_at || '').localeCompare(a.updated_at || a.created_at || '')).map((s) => (
            <div key={s.id} className={`row${s.id === sid ? ' on' : ''}`} onClick={() => setSid(s.id)}>
              <span className="r-main">
                <span className="r-t">{s.title || `会话 ${s.id}`}</span>
                <span className="r-s">{(s.updated_at || s.created_at || '').slice(0, 16)}</span>
              </span>
              <button className="icon-btn row-act" title="删除会话"
                onClick={(e) => { e.stopPropagation(); delSession(s.id) }}>✕</button>
            </div>
          ))}
        </div>
      </aside>

      {/* ---------- 消息区 ---------- */}
      <div className="col-main-inner">
        <div className="chat-wrap">
          <div className="chat-scroll" ref={boxRef}>
            <div className="chat-inner">
              {msgs.length === 0 && (
                <div className="notice kai" style={{ fontSize: 13 }}>
                  {cur
                    ? <>这个会话还是空的。问我续写、伏笔、节奏、人物，或点下面的快捷指令——回答全部来自《{project.title}》此刻的真实数据。</>
                    : <>《{project.title}》还没有选中的会话。新建一个，从一句「你好」开始，我会先盘点这本书的家底。</>}
                </div>
              )}
              {msgs.map((m, i) => <MsgView key={i} m={m} onToggle={(fn) => {
                setMsgs((curMsgs) => {
                  const next = [...curMsgs]
                  const mm = { ...next[i] }
                  fn(mm)
                  next[i] = mm
                  return next
                })
              }} />)}
            </div>
          </div>

          <div className="chips">
            {CHIPS.map((c) => (
              <button key={c.t} className="chip" disabled={busy} onClick={() => send(c.q)}>{c.t}</button>
            ))}
          </div>

          <div className="chat-input">
            <div className="ci-box">
              <textarea ref={taRef} rows={1} value={input}
                placeholder={`问点什么…（《${project.title}》）`}
                onChange={(e) => {
                  setInput(e.target.value)
                  e.target.style.height = 'auto'
                  e.target.style.height = Math.min(150, e.target.scrollHeight) + 'px'
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
                }} />
              {busy ? (
                <button className="btn danger" onClick={stop}>■ 停止生成</button>
              ) : (
                <button className="btn primary" disabled={!input.trim()} onClick={() => send()}>落笔</button>
              )}
            </div>
            <div className="ci-meta">
              <span>Enter 发送 · Shift+Enter 换行</span>
              <span className="grow" />
              {stats && <span className="tag">人物 {stats.chars}</span>}
              {stats && <span className="tag">伏笔 {stats.fsp} · 悬空 {stats.fspDangling}</span>}
              {stats && <span className="tag">章节 {stats.written}/{stats.plan}</span>}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ---------- 单条消息：思考折叠 → 工具卡片 → markdown 正文 ---------- */
function MsgView({ m, onToggle }: { m: Msg; onToggle: (fn: (ai: Msg) => void) => void }) {
  const [thinkOpen, setThinkOpen] = useState(true)
  if (m.role === 'user') {
    return (
      <div className="msg user fade-in">
        <span className="avatar">我</span>
        <div className="bubble"><div className="md-body" dangerouslySetInnerHTML={{ __html: mdToHtml(m.content) }} /></div>
      </div>
    )
  }
  const live = !!m.streaming
  const open = live ? true : thinkOpen
  return (
    <div className="msg ai fade-in">
      <span className="avatar">墨</span>
      <div className="bubble">
        <div className="who"><b>墨案 · Agent</b><span className="tag">数据驱动</span></div>
        {(m.thinking?.length ?? 0) > 0 && (
          <div className={`think${open ? ' open' : ''}${live ? ' live' : ''}`}>
            <div className="think-hd" onClick={() => !live && setThinkOpen((v) => !v)}>
              {live && <span className="pulse" />}
              <span>{live ? '正在思考…' : '思考过程'}</span>
              <svg className="chev" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={1.4}>
                <path d="M3 9l4-4 4 4" />
              </svg>
            </div>
            {open && (
              <div className="think-body">
                {m.thinking!.map((t, i) => <span key={i}>· {t}</span>)}
              </div>
            )}
          </div>
        )}
        {(m.tools || []).map((t, j) => (
          <div key={j} className={`toolcard${t.done && t.open ? ' open' : ''}`}>
            <div className="tc-hd" onClick={() => t.done && onToggle((ai) => {
              ai.tools = (ai.tools || []).map((x, k) => k === j ? { ...x, open: !x.open } : x)
            })}>
              <span className="tc-name">{t.name}</span>
              {t.args && <span className="tc-args">{t.args}</span>}
              {t.done ? (
                <span className="tc-state done">✓ 完成</span>
              ) : (
                <span className="tc-state run"><span className="spinner" /> 调用中</span>
              )}
            </div>
            <div className="tc-result">{t.result || '（无返回内容）'}</div>
          </div>
        ))}
        <div className="md-body">
          <span dangerouslySetInnerHTML={{ __html: mdToHtml(m.content) }} />
          {m.streaming && <span className="cursor" />}
        </div>
      </div>
    </div>
  )
}

/* 历史消息工具卡必须「完成」态且可展开（E9）；流式中的卡走 调用中→完成 状态机 */
