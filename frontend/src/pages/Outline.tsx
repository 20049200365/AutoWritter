/* 大纲与伏笔：三级树（卷卡片）+ 伏笔四态追踪（标记对齐参考模板；回收纯用户驱动） */
import { useEffect, useMemo, useState } from 'react'
import { api, Chapter, CH_STATUS, Foreshadow, OutlineNode, Project } from '../api'
import { Empty, Modal } from '../ui'

const FSP_TAG: Record<string, string> = { 已埋设: 'qing', 部分揭示: 'zhe', 已回收: 'lv', 悬空: 'seal' }

export default function OutlinePage({ project, onChanged }: {
  project: Project; onChanged: () => void
}) {
  const [nodes, setNodes] = useState<OutlineNode[]>([])
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [fsps, setFsps] = useState<Foreshadow[]>([])
  const [editNode, setEditNode] = useState<OutlineNode | 'new' | null>(null)
  const [newFsp, setNewFsp] = useState(false)

  const load = async () => {
    const [ns, cs, fs] = await Promise.all([
      api.get<OutlineNode[]>(`/projects/${project.id}/outline`),
      api.get<Chapter[]>(`/projects/${project.id}/chapters`),
      api.get<Foreshadow[]>(`/foreshadows?project_id=${project.id}`),
    ])
    setNodes(ns); setChapters(cs); setFsps(fs)
  }
  useEffect(() => { load() }, [project.id])

  const roots = useMemo(() => nodes.filter((n) => n.parent_id === null).sort((a, b) => a.sort - b.sort), [nodes])
  const kids = (id: number) => nodes.filter((n) => n.parent_id === id).sort((a, b) => a.sort - b.sort)

  async function cycleStatus(n: OutlineNode) {
    const i = CH_STATUS.indexOf(n.status)
    const next = CH_STATUS[(i + 1) % CH_STATUS.length]
    await api.patch(`/outline/${n.id}`, { status: next })
    await load(); onChanged()
  }

  async function removeNode(n: OutlineNode) {
    if (!confirm(`删除「${n.title}」及其子树？`)) return
    await api.del(`/outline/${n.id}`)
    await load(); onChanged()
  }

  const done = fsps.filter((f) => f.state === '已回收').length
  const rate = fsps.length ? Math.round((done / fsps.length) * 100) : 0
  const dangling = fsps.filter((f) => f.state === '悬空').length

  return (
    <div className="out-wrap">
      <div className="out-inner">
        {/* 统计卡 */}
        <div className="statcards">
          <div className="card statcard"><span className="sc-v">{roots.length}</span><span className="sc-l">卷</span></div>
          <div className="card statcard"><span className="sc-v">{nodes.length}</span><span className="sc-l">大纲节点</span></div>
          <div className="card statcard"><span className="sc-v">{chapters.length}</span><span className="sc-l">章节</span></div>
          <div className={`card statcard${dangling > 0 ? ' warn' : ''}`}>
            <span className="sc-v">{done}/{fsps.length}</span><span className="sc-l">伏笔回收（悬空 {dangling}）</span></div>
        </div>

        {/* 卷章结构 */}
        {roots.length === 0 ? (
          <Empty text="大纲未立，先开一卷" actionText="建卷" onAction={() => setEditNode('new')} />
        ) : roots.map((v) => (
          <div key={v.id} className="card vol-card">
            <div className="vol-hd">
              <span className="v-name">{v.title}</span>
              <span className="v-range">{kids(v.id).length} 篇</span>
              <span className="v-sum">{v.summary || ''}</span>
              <button className="icon-btn" title="编辑卷" onClick={() => setEditNode(v)}>✎</button>
              <button className="icon-btn" title="加篇" onClick={() => setEditNode({ ...v, __new: 1 } as any)}>＋</button>
              <button className="icon-btn" title="删除卷" onClick={() => removeNode(v)}>✕</button>
            </div>
            {kids(v.id).map((s) => (
              <div key={s.id}>
                <NodeRow node={s} chapters={chapters} onEdit={() => setEditNode(s)}
                  onCycle={() => cycleStatus(s)} onRemove={() => removeNode(s)}
                  onAdd={() => setEditNode({ ...s, __new: 1 } as any)} />
                {kids(s.id).map((b) => (
                  <div key={b.id} style={{ paddingLeft: 26 }}>
                    <NodeRow node={b} chapters={chapters} onEdit={() => setEditNode(b)}
                      onCycle={() => cycleStatus(b)} onRemove={() => removeNode(b)} />
                  </div>
                ))}
              </div>
            ))}
          </div>
        ))}
        <div><button className="btn" onClick={() => setEditNode('new')}>＋ 新卷</button></div>

        {/* 伏笔追踪 */}
        <div className="card vol-card">
          <div className="vol-hd">
            <span className="v-name">伏笔追踪</span>
            <span className="v-range">回收率 {rate}%</span>
            <span className="v-sum" />
            <button className="btn sm primary" onClick={() => setNewFsp(true)}>＋ 埋伏笔</button>
          </div>
          {fsps.length === 0 ? (
            <Empty text="还没有伏笔" actionText="埋第一条" onAction={() => setNewFsp(true)} />
          ) : fsps.map((f) => (
            <FspRow key={f.id} fsp={f} chapters={chapters} onChanged={async () => { await load(); onChanged() }} />
          ))}
          <div style={{ padding: 12 }}>
            <div className="riskline info">回收由你指定：点「回收」选择章节。AI 只提建议，不动状态。</div>
          </div>
        </div>
      </div>

      {editNode && (
        <NodeModal project={project} node={(editNode as any).__new ? null : editNode as OutlineNode}
          presetParent={(editNode as any).__new ? (editNode as OutlineNode).id : undefined}
          roots={roots}
          onClose={() => setEditNode(null)} onSaved={async () => { setEditNode(null); await load(); onChanged() }} />
      )}
      {newFsp && (
        <FspModal project={project} chapters={chapters} onClose={() => setNewFsp(false)}
          onSaved={async () => { setNewFsp(false); await load(); onChanged() }} />
      )}
    </div>
  )
}

function NodeRow({ node, chapters, onEdit, onCycle, onRemove, onAdd }: {
  node: OutlineNode; chapters: Chapter[]; onEdit: () => void; onCycle: () => void; onRemove: () => void; onAdd?: () => void
}) {
  const linked = chapters.filter((c) => c.outline_node_id === node.id)
  return (
    <div className="ch-row">
      <span className="ch-title">{node.title}</span>
      <span className="ch-beat">{node.summary || ''}</span>
      {linked.map((c) => <span key={c.id} className="tag mono">CH.{String(c.seq).padStart(2, '0')}</span>)}
      <button className="tag" onClick={onCycle} title="点击循环切换状态">{node.status}</button>
      <span className="row-act" style={{ display: 'inline-flex', gap: 2 }}>
        {onAdd && <button className="icon-btn" title="加子节点" onClick={onAdd}>＋</button>}
        <button className="icon-btn" title="编辑" onClick={onEdit}>✎</button>
        <button className="icon-btn" title="删除" onClick={onRemove}>✕</button>
      </span>
    </div>
  )
}

function NodeModal({ project, node, presetParent, roots, onClose, onSaved }: {
  project: Project; node: OutlineNode | null; presetParent?: number; roots: OutlineNode[];
  onClose: () => void; onSaved: () => void
}) {
  const [title, setTitle] = useState(node?.title || '')
  const [summary, setSummary] = useState(node?.summary || '')
  const [parentId, setParentId] = useState<number | ''>(node?.parent_id ?? presetParent ?? '')

  async function save() {
    if (!title.trim()) return
    const payload = { title: title.trim(), summary: summary || null }
    if (node) {
      await api.patch(`/outline/${node.id}`, payload)
    } else {
      await api.post('/outline', {
        project_id: project.id, parent_id: parentId === '' ? null : parentId, ...payload,
      })
    }
    onSaved()
  }

  return (
    <Modal title={node ? `编辑节点：${node.title}` : '新建大纲节点'} onClose={onClose}>
      <div className="f-row"><label>挂载到（不选=新卷）</label>
        <select value={parentId} onChange={(e) => setParentId(e.target.value === '' ? '' : +e.target.value)}>
          <option value="">—— 顶层（卷）——</option>
          {presetParent != null && !roots.some((r) => r.id === presetParent) &&
            <option value={presetParent}>（当前节点下）</option>}
          {roots.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
        </select>
      </div>
      <div className="f-row"><label>标题</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="f-row"><label>概要 / 节拍</label>
        <textarea rows={4} value={summary} onChange={(e) => setSummary(e.target.value)} />
      </div>
      <div className="m-acts">
        <button className="btn" onClick={onClose}>取消</button>
        <button className="btn primary" disabled={!title.trim()} onClick={save}>保存</button>
      </div>
    </Modal>
  )
}

function FspRow({ fsp, chapters, onChanged }: {
  fsp: Foreshadow; chapters: Chapter[]; onChanged: () => Promise<void>
}) {
  const [resolving, setResolving] = useState(false)
  const plant = chapters.find((c) => c.id === fsp.planted_chapter_id)
  const planned = chapters.find((c) => c.id === fsp.planned_resolve_chapter_id)
  const actual = chapters.find((c) => c.id === fsp.actual_resolve_chapter_id)
  const span = plant && planned ? Math.abs(planned.seq - plant.seq) : null

  async function resolve(chId: number) {
    await api.post(`/foreshadows/${fsp.id}/resolve`, { chapter_id: chId })
    setResolving(false); await onChanged()
  }
  async function unresolve() {
    await api.post(`/foreshadows/${fsp.id}/unresolve`)
    await onChanged()
  }
  async function remove() {
    if (!confirm(`删除伏笔「${fsp.title}」？`)) return
    await api.del(`/foreshadows/${fsp.id}`)
    await onChanged()
  }

  return (
    <div className="fsp-row">
      <div className="fs-top">
        <span className={`tag ${FSP_TAG[fsp.state] || ''}`}>{fsp.state}</span>
        <span className="fs-name">{'●'.repeat(fsp.importance)} {fsp.title}</span>
        <span style={{ flex: 1 }} />
        {fsp.state !== '已回收' ? (
          resolving ? (
            <select className="select" style={{ width: 160, padding: '3px 8px', fontSize: 12 }} autoFocus defaultValue=""
              onChange={(e) => e.target.value && resolve(+e.target.value)}
              onBlur={() => setResolving(false)}>
              <option value="" disabled>选择回收章…</option>
              {chapters.map((c) => <option key={c.id} value={c.id}>CH.{String(c.seq).padStart(2, '0')} {c.title}</option>)}
            </select>
          ) : (
            <button className="btn sm" onClick={() => setResolving(true)}>回收</button>
          )
        ) : (
          <button className="btn sm" onClick={unresolve}>撤销回收</button>
        )}
        <button className="icon-btn" onClick={remove} title="删除">✕</button>
      </div>
      {fsp.description && <span className="fs-note">{fsp.description}</span>}
      <span className="fs-path">
        {plant ? `埋于 CH.${String(plant.seq).padStart(2, '0')}` : '未指定埋设章'}
        <span className="dots"><i className="f" /><i className={planned || actual ? 'f' : ''} /><i className={actual ? 'f' : ''} /></span>
        {planned && `计划 CH.${String(planned.seq).padStart(2, '0')} 回收`}
        {actual && ` · 已于 CH.${String(actual.seq).padStart(2, '0')} 回收`}
        {span != null && span > 12 && <span className="tag zhe">跨度 {span} 章，注意读者遗忘</span>}
      </span>
    </div>
  )
}

function FspModal({ project, chapters, onClose, onSaved }: {
  project: Project; chapters: Chapter[]; onClose: () => void; onSaved: () => void
}) {
  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')
  const [importance, setImportance] = useState(1)
  const [plantedId, setPlantedId] = useState<number | ''>('')
  const [plannedId, setPlannedId] = useState<number | ''>('')

  async function save() {
    if (!title.trim()) return
    await api.post('/foreshadows', {
      project_id: project.id, title: title.trim(), description: desc || null,
      importance,
      planted_chapter_id: plantedId === '' ? null : plantedId,
      planned_resolve_chapter_id: plannedId === '' ? null : plannedId,
    })
    onSaved()
  }

  return (
    <Modal title="埋伏笔" onClose={onClose}>
      <div className="f-row"><label>名称</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如：剑灵来历" />
      </div>
      <div className="f-row"><label>描述</label>
        <textarea rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} />
      </div>
      <div className="f-grid">
        <div className="f-row"><label>重要度</label>
          <select value={importance} onChange={(e) => setImportance(+e.target.value)}>
            <option value={1}>● 一般</option><option value={2}>●● 重要</option><option value={3}>●●● 核心</option>
          </select>
        </div>
        <div className="f-row"><label>埋设于</label>
          <select value={plantedId} onChange={(e) => setPlantedId(e.target.value === '' ? '' : +e.target.value)}>
            <option value="">未指定</option>
            {chapters.map((c) => <option key={c.id} value={c.id}>CH.{String(c.seq).padStart(2, '0')}</option>)}
          </select>
        </div>
      </div>
      <div className="f-row"><label>计划回收章（不填=悬空）</label>
        <select value={plannedId} onChange={(e) => setPlannedId(e.target.value === '' ? '' : +e.target.value)}>
          <option value="">—— 悬空 ——</option>
          {chapters.map((c) => <option key={c.id} value={c.id}>CH.{String(c.seq).padStart(2, '0')}</option>)}
        </select>
      </div>
      <div className="m-acts">
        <button className="btn" onClick={onClose}>取消</button>
        <button className="btn primary" disabled={!title.trim()} onClick={save}>埋下</button>
      </div>
    </Modal>
  )
}
