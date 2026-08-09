/* 大纲与伏笔：三级树（卷卡片）+ 伏笔四态追踪 + 一致性巡检（回收纯用户驱动） */
import { useEffect, useMemo, useState } from 'react'
import { api, Chapter, CH_STATUS, fmtCh, Foreshadow, OutlineNode, Project } from '../api'
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
  const [inspect, setInspect] = useState(false)

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
        <div style={{ display: 'flex', gap: 12, alignItems: 'stretch' }}>
          <div className="statcards" style={{ flex: 1 }}>
            <div className="card statcard"><span className="sc-v">{roots.length}</span><span className="sc-l">卷</span></div>
            <div className="card statcard"><span className="sc-v">{nodes.length}</span><span className="sc-l">大纲节点</span></div>
            <div className="card statcard"><span className="sc-v">{chapters.length}</span><span className="sc-l">章节</span></div>
            <div className={`card statcard${dangling > 0 ? ' warn' : ''}`}>
              <span className="sc-v">{done}/{fsps.length}</span><span className="sc-l">伏笔回收（悬空 {dangling}）</span></div>
          </div>
          <button className="btn" style={{ alignSelf: 'center' }} onClick={() => setInspect(true)}>◎ 一致性巡检</button>
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
      {inspect && (
        <InspectModal nodes={nodes} chapters={chapters} fsps={fsps} onClose={() => setInspect(false)} />
      )}
    </div>
  )
}

/* ---------- 一致性巡检：全部由真实数据计算（对齐参考模板 inspectCompute） ---------- */
interface Issue { lv: 'H' | 'M' | 'L'; where: string; text: string }

function inspectCompute(nodes: OutlineNode[], chapters: Chapter[], fsps: Foreshadow[]): Issue[] {
  const out: Issue[] = []
  const seqOf = (id?: number | null) => chapters.find((c) => c.id === id)?.seq
  /* 叶子节点（带张力/状态的章级节点）按树序 */
  const kids = (pid: number | null) => nodes.filter((n) => n.parent_id === pid).sort((a, b) => a.sort - b.sort)
  const leaves: OutlineNode[] = []
  const walk = (pid: number | null) => {
    for (const n of kids(pid)) {
      if (nodes.some((x) => x.parent_id === n.id)) walk(n.id)
      else leaves.push(n)
    }
  }
  walk(null)

  fsps.forEach((f) => {
    const plant = seqOf(f.planted_chapter_id)
    const planned = seqOf(f.planned_resolve_chapter_id)
    if (f.state === '悬空') {
      out.push({ lv: 'H', where: '伏笔', text: `「${f.title}」${plant ? `（${fmtCh(plant)} 埋设）` : ''}悬空未规划回收，读者期待无落点。` })
    }
    if (plant != null && planned != null && planned - plant > 12) {
      out.push({ lv: 'M', where: '伏笔', text: `「${f.title}」跨度 ${planned - plant} 章（${fmtCh(plant)}→${fmtCh(planned)}），超过 12 章遗忘线，建议中途补一次提醒。` })
    }
    if (f.planned_resolve_chapter_id && f.state !== '已回收') {
      const tgt = chapters.find((c) => c.id === f.planned_resolve_chapter_id)
      if (tgt && tgt.status === '定稿') {
        out.push({ lv: 'H', where: fmtCh(tgt.seq), text: `「${f.title}」计划回收章 ${fmtCh(tgt.seq)} 已定稿，但伏笔仍未回收——定稿章里它必须有交代。` })
      }
    }
  })
  /* 连续三章张力接近 → 节奏平台期 */
  const ts = leaves.filter((n) => n.tension != null)
  for (let i = 0; i + 2 < ts.length; i++) {
    const [a, b, c] = [ts[i].tension!, ts[i + 1].tension!, ts[i + 2].tension!]
    if (Math.abs(a - b) <= 1 && Math.abs(b - c) <= 1) {
      out.push({ lv: 'M', where: `节拍 ${i + 1}–${i + 3}`, text: '连续三节张力接近，节奏进入平台期，建议中段插入小揭示或小损失。' })
      i += 2
    }
  }
  if (!out.length) out.push({ lv: 'L', where: '全局', text: '未发现问题。数据层面的自洽性良好。' })
  const order = { H: 0, M: 1, L: 2 }
  return out.sort((x, y) => order[x.lv] - order[y.lv])
}

function InspectModal({ nodes, chapters, fsps, onClose }: {
  nodes: OutlineNode[]; chapters: Chapter[]; fsps: Foreshadow[]; onClose: () => void
}) {
  const steps = ['扫描伏笔清单…', '核对章纲状态…', '计算张力曲线…', '汇总分级问题…']
  const [step, setStep] = useState(0)
  const [items, setItems] = useState<Issue[] | null>(null)

  useEffect(() => {
    if (step < steps.length) {
      const t = setTimeout(() => setStep((s) => s + 1), 420)
      return () => clearTimeout(t)
    }
    setItems(inspectCompute(nodes, chapters, fsps))
  }, [step])   // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Modal title="一致性巡检" onClose={onClose}>
      {!items ? (
        <>
          <div className="notice">◎ {steps[Math.min(step, steps.length - 1)]}</div>
          <div className="progress" style={{ marginTop: 10 }}>
            <i style={{ width: `${8 + step * 24}%` }} />
          </div>
        </>
      ) : (
        <>
          <p className="m-sub">检出 {items.length} 项（全部由当前数据计算）</p>
          <div className="card vol-card" style={{ marginBottom: 12 }}>
            {items.map((it, i) => (
              <div key={i} className="inspect-item">
                <span className={`lv ${it.lv}`}>{it.lv === 'H' ? '高' : it.lv === 'M' ? '中' : '低'}</span>
                <span className="where">{it.where}</span>
                <span>{it.text}</span>
              </div>
            ))}
          </div>
          <div className="m-acts"><button className="btn" onClick={onClose}>关闭</button></div>
        </>
      )}
    </Modal>
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
