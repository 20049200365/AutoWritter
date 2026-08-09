/* 大纲与伏笔（M7 §9.2 页面 5）：三级树 CRUD + 伏笔四态追踪（回收纯用户驱动） */
import { useEffect, useMemo, useState } from 'react'
import { api, Chapter, CH_STATUS, Foreshadow, FSP_STATES, OutlineNode, Project } from '../api'
import { Empty, Modal } from '../ui'

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

  const roots = useMemo(() => nodes.filter((n) => n.parent_id === null), [nodes])
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

  return (
    <div className="grid cols-2">
      {/* ---------- 大纲树 ---------- */}
      <section className="card">
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
          <h2 className="h2" style={{ marginBottom: 0 }}>卷章结构</h2>
          <span style={{ flex: 1 }} />
          <button className="btn primary sm" onClick={() => setEditNode('new')}>＋ 卷/篇/节拍</button>
        </div>
        {roots.length === 0 ? (
          <Empty text="大纲未立，先开一卷" actionText="建卷" onAction={() => setEditNode('new')} />
        ) : (
          <div>
            {roots.sort((a, b) => a.sort - b.sort).map((v) => (
              <div key={v.id} style={{ marginBottom: 8 }}>
                <NodeRow node={v} chapters={chapters} onEdit={() => setEditNode(v)}
                  onCycle={() => cycleStatus(v)} onRemove={() => removeNode(v)} />
                {kids(v.id).map((s) => (
                  <div key={s.id} style={{ marginLeft: 18 }}>
                    <NodeRow node={s} chapters={chapters} onEdit={() => setEditNode(s)}
                      onCycle={() => cycleStatus(s)} onRemove={() => removeNode(s)} />
                    {kids(s.id).map((b) => (
                      <div key={b.id} style={{ marginLeft: 18 }}>
                        <NodeRow node={b} chapters={chapters} onEdit={() => setEditNode(b)}
                          onCycle={() => cycleStatus(b)} onRemove={() => removeNode(b)} />
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ---------- 伏笔追踪 ---------- */}
      <section className="card">
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
          <h2 className="h2" style={{ marginBottom: 0 }}>伏笔追踪</h2>
          <span style={{ flex: 1 }} />
          <span className="mono hint" style={{ marginRight: 10 }}>回收率 {rate}%</span>
          <button className="btn primary sm" onClick={() => setNewFsp(true)}>＋ 埋伏笔</button>
        </div>
        <div style={{ height: 6, background: 'var(--paper-2)', borderRadius: 3, marginBottom: 12 }}>
          <div style={{ height: 6, width: `${rate}%`, background: 'var(--leaf)', borderRadius: 3 }} />
        </div>
        {fsps.length === 0 ? (
          <Empty text="还没有伏笔" actionText="埋第一条" onAction={() => setNewFsp(true)} />
        ) : (
          <div className="row-list">
            {fsps.map((f) => (
              <FspRow key={f.id} fsp={f} chapters={chapters} onChanged={async () => { await load(); onChanged() }} />
            ))}
          </div>
        )}
        <p className="hint kai" style={{ marginTop: 10 }}>
          回收由你指定：点「回收」选择章节。AI 只提建议，不动状态。
        </p>
      </section>

      {editNode && (
        <NodeModal project={project} node={editNode === 'new' ? null : editNode} roots={roots}
          onClose={() => setEditNode(null)} onSaved={async () => { setEditNode(null); await load(); onChanged() }} />
      )}
      {newFsp && (
        <FspModal project={project} chapters={chapters} onClose={() => setNewFsp(false)}
          onSaved={async () => { setNewFsp(false); await load(); onChanged() }} />
      )}
    </div>
  )
}

function NodeRow({ node, chapters, onEdit, onCycle, onRemove }: {
  node: OutlineNode; chapters: Chapter[]; onEdit: () => void; onCycle: () => void; onRemove: () => void
}) {
  const linked = chapters.filter((c) => c.outline_node_id === node.id)
  return (
    <div className="tree-node">
      <span className={`lv${Math.min(node.level, 3)}`}>{node.title}</span>
      <button className={`pill sm`} onClick={onCycle} title="点击循环切换状态">{node.status}</button>
      {linked.map((c) => <span key={c.id} className="pill mono">CH.{String(c.seq).padStart(2, '0')}</span>)}
      {node.summary && <span className="hint" style={{ fontSize: 11 }}>· {node.summary.slice(0, 24)}{node.summary.length > 24 ? '…' : ''}</span>}
      <span style={{ flex: 1 }} />
      <button className="icon-btn" onClick={onEdit} title="编辑">✎</button>
      <button className="icon-btn" onClick={onRemove} title="删除">✕</button>
    </div>
  )
}

function NodeModal({ project, node, roots, onClose, onSaved }: {
  project: Project; node: OutlineNode | null; roots: OutlineNode[];
  onClose: () => void; onSaved: () => void
}) {
  const [title, setTitle] = useState(node?.title || '')
  const [summary, setSummary] = useState(node?.summary || '')
  const [parentId, setParentId] = useState<number | ''>(node?.parent_id ?? '')

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
      <label className="field"><span>挂载到（不选=新卷）</span>
        <select className="select" value={parentId} onChange={(e) => setParentId(e.target.value === '' ? '' : +e.target.value)}>
          <option value="">—— 顶层（卷）——</option>
          {roots.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
        </select>
      </label>
      <label className="field"><span>标题</span>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="field"><span>概要 / 节拍</span>
        <textarea className="input" rows={4} value={summary} onChange={(e) => setSummary(e.target.value)} />
      </label>
      <div className="actions">
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
    <div className="row-item">
      <span className={`pill ${FSP_STATES[fsp.state] || ''}`}>{fsp.state}</span>
      <span className="grow">
        <span className="t">{'●'.repeat(fsp.importance)} {fsp.title}</span>
        <span className="s" style={{ display: 'block' }}>
          {plant ? `埋于 CH.${String(plant.seq).padStart(2, '0')}` : '未指定埋设章'}
          {planned && ` → 计划 CH.${String(planned.seq).padStart(2, '0')} 回收`}
          {actual && ` · 已于 CH.${String(actual.seq).padStart(2, '0')} 回收`}
          {span != null && span > 12 && <span style={{ color: 'var(--ochre)' }}> ⚠ 跨度 {span} 章，注意读者遗忘</span>}
        </span>
      </span>
      {fsp.state !== '已回收' ? (
        resolving ? (
          <select className="select" style={{ width: 140 }} autoFocus defaultValue=""
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
      <label className="field"><span>名称</span>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如：剑灵来历" />
      </label>
      <label className="field"><span>描述</span>
        <textarea className="input" rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} />
      </label>
      <label className="field"><span>重要度</span>
        <select className="select" value={importance} onChange={(e) => setImportance(+e.target.value)}>
          <option value={1}>● 一般</option><option value={2}>●● 重要</option><option value={3}>●●● 核心</option>
        </select>
      </label>
      <div style={{ display: 'flex', gap: 10 }}>
        <label className="field" style={{ flex: 1 }}><span>埋设于</span>
          <select className="select" value={plantedId} onChange={(e) => setPlantedId(e.target.value === '' ? '' : +e.target.value)}>
            <option value="">未指定</option>
            {chapters.map((c) => <option key={c.id} value={c.id}>CH.{String(c.seq).padStart(2, '0')}</option>)}
          </select>
        </label>
        <label className="field" style={{ flex: 1 }}><span>计划回收章（不填=悬空）</span>
          <select className="select" value={plannedId} onChange={(e) => setPlannedId(e.target.value === '' ? '' : +e.target.value)}>
            <option value="">—— 悬空 ——</option>
            {chapters.map((c) => <option key={c.id} value={c.id}>CH.{String(c.seq).padStart(2, '0')}</option>)}
          </select>
        </label>
      </div>
      <div className="actions">
        <button className="btn" onClick={onClose}>取消</button>
        <button className="btn primary" disabled={!title.trim()} onClick={save}>埋下</button>
      </div>
    </Modal>
  )
}
