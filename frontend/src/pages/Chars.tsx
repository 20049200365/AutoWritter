/* 人物与实体图（M7 §9.2 页面 4）：d3-force 实体图（人物+世界观实体）+ 写作导向档案
   边类型自由文本：常用类型专属配色，自造类型按名称哈希取色（M1 决策） */
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide,
  SimulationNodeDatum, SimulationLinkDatum,
} from 'd3-force'
import { api, Character, Project, Relation, WorldEntry } from '../api'
import { Empty, Modal } from '../ui'

const REL_COLORS: Record<string, string> = {
  血缘: '#a8433a', 亲和: '#6f8f62', 对抗: '#b98a45',
  秘密: '#7c5f8f', 师徒: '#40635c', 造物: '#55504a',
}
function relColor(type: string): string {
  if (REL_COLORS[type]) return REL_COLORS[type]
  let h = 0
  for (const ch of type) h = (h * 31 + ch.charCodeAt(0)) % 360
  return `hsl(${h}, 32%, 42%)`
}

interface GNode extends SimulationNodeDatum {
  id: string; kind: 'char' | 'world'; refId: number; name: string; role?: string
}
interface GLink extends SimulationLinkDatum<GNode> { type: string; label?: string }

export default function CharsPage({ project, onChanged }: {
  project: Project; onChanged: () => void
}) {
  const [chars, setChars] = useState<Character[]>([])
  const [worlds, setWorlds] = useState<WorldEntry[]>([])
  const [rels, setRels] = useState<Relation[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [editChar, setEditChar] = useState<Character | 'new' | null>(null)
  const [editRel, setEditRel] = useState(false)
  const [filter, setFilter] = useState<'全部' | '人物' | '实体'>('全部')

  const load = async () => {
    const [cs, ws, rs] = await Promise.all([
      api.get<Character[]>(`/characters?project_id=${project.id}`),
      api.get<WorldEntry[]>(`/world-entries?project_id=${project.id}`),
      api.get<Relation[]>(`/relations?project_id=${project.id}`),
    ])
    setChars(cs); setWorlds(ws); setRels(rs)
  }
  useEffect(() => { load() }, [project.id])

  const nodes = useMemo<GNode[]>(() => {
    const cn: GNode[] = chars.map((c) => ({
      id: `char:${c.id}`, kind: 'char', refId: c.id, name: c.name, role: c.role || undefined,
    }))
    const usedWorld = new Set<number>()
    rels.forEach((r) => {
      if (r.src_kind === 'world') usedWorld.add(r.src_id)
      if (r.dst_kind === 'world') usedWorld.add(r.dst_id)
    })
    const wn: GNode[] = worlds.filter((w) => usedWorld.has(w.id)).map((w) => ({
      id: `world:${w.id}`, kind: 'world', refId: w.id, name: w.name, role: w.category,
    }))
    const all = [...cn, ...wn]
    return filter === '人物' ? all.filter((n) => n.kind === 'char')
      : filter === '实体' ? cn.length ? all : all : all
  }, [chars, worlds, rels, filter])

  const nodeIds = useMemo(() => new Set(nodes.map((n) => n.id)), [nodes])
  const links = useMemo<GLink[]>(() => rels
    .filter((r) => nodeIds.has(`${r.src_kind}:${r.src_id}`) && nodeIds.has(`${r.dst_kind}:${r.dst_id}`))
    .map((r) => ({
      source: `${r.src_kind}:${r.src_id}`, target: `${r.dst_kind}:${r.dst_id}`,
      type: r.type, label: r.label || undefined,
    })), [rels, nodeIds])

  const selChar = selected?.startsWith('char:')
    ? chars.find((c) => c.id === +selected.slice(5)) : null
  const selRels = selected ? rels.filter((r) =>
    `${r.src_kind}:${r.src_id}` === selected || `${r.dst_kind}:${r.dst_id}` === selected) : []

  return (
    <div className="chars-wrap">
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', padding: '12px 16px' }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center' }}>
          <div className="seg">
            {(['全部', '人物', '实体'] as const).map((f) => (
              <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>{f}</button>
            ))}
          </div>
          <span style={{ flex: 1 }} />
          <button className="btn sm" onClick={() => setEditRel(true)}>＋ 关系</button>
          <button className="btn primary sm" onClick={() => setEditChar('new')}>＋ 人物</button>
        </div>
        {chars.length === 0 ? (
          <Empty text="人物谱尚空" sub="先登记主角——他想要什么、怕什么、和谁对立，关系图会自动长出来。"
            actionText="＋ 立第一个人" onAction={() => setEditChar('new')} />
        ) : (
          <Graph nodes={nodes} links={links} selected={selected} onSelect={setSelected} />
        )}
      </div>

      {selChar ? (
        <CharProfile char={selChar} rels={selRels} chars={chars} worlds={worlds}
          onEdit={() => setEditChar(selChar)} onChanged={load} />
      ) : (
        <aside className="profile">
          <div className="pf-hd">
            <span className="pf-seal">谱</span>
            <div>
              <h3>人物列表</h3>
              <span className="pf-role">{chars.length} 人 · 点图中节点看档案</span>
            </div>
          </div>
          {chars.map((c) => (
            <button key={c.id} className="row" onClick={() => setSelected(`char:${c.id}`)}>
              <span className="r-main">
                <span className="r-t">{c.name}</span>
                <span className="r-s">{c.role || '未定位'} · {c.gender || '—'}</span>
              </span>
              <span className="row-act icon-btn" onClick={(e) => { e.stopPropagation(); setEditChar(c) }}>✎</span>
            </button>
          ))}
          <div className="notice">「想要什么」与「真正需要什么」要打架，人物才立得住。</div>
        </aside>
      )}

      {editChar && (
        <CharModal project={project} char={editChar === 'new' ? null : editChar}
          onClose={() => setEditChar(null)}
          onSaved={async () => { setEditChar(null); await load(); onChanged() }} />
      )}
      {editRel && (
        <RelModal project={project} chars={chars} worlds={worlds}
          onClose={() => setEditRel(false)}
          onSaved={async () => { setEditRel(false); await load(); onChanged() }} />
      )}
    </div>
  )
}

/* ---------- d3-force 图 ---------- */
function Graph({ nodes, links, selected, onSelect }: {
  nodes: GNode[]; links: GLink[]; selected: string | null; onSelect: (id: string | null) => void
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [, setTick] = useState(0)

  useEffect(() => {
    const el = boxRef.current
    if (!el || nodes.length === 0) return
    const w = el.clientWidth, h = Math.max(el.clientHeight, 380)
    // 初始坐标：环形铺开（避免挤成一团），物理只做微调
    nodes.forEach((n, i) => {
      const angle = (i / nodes.length) * Math.PI * 2
      n.x = w / 2 + Math.cos(angle) * Math.min(w, h) * 0.36
      n.y = h / 2 + Math.sin(angle) * Math.min(w, h) * 0.36
    })
    const sim = forceSimulation(nodes as SimulationNodeDatum[])
      .force('link', forceLink(links as SimulationLinkDatum<SimulationNodeDatum>[])
        .id((d: any) => d.id).distance(110).strength(0.4))
      .force('charge', forceManyBody().strength(-320))
      .force('center', forceCenter(w / 2, h / 2))
      .force('collide', forceCollide(34))
      .alphaDecay(0.05)
      .on('tick', () => setTick((t) => t + 1))
    return () => { sim.stop() }
  }, [nodes, links])

  // 拖拽
  const dragRef = useRef<GNode | null>(null)
  function pos(e: React.PointerEvent) {
    const rect = svgRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const related = useMemo(() => {
    if (!selected) return null
    const set = new Set<string>([selected])
    links.forEach((l) => {
      const s = typeof l.source === 'object' ? (l.source as GNode).id : String(l.source)
      const t = typeof l.target === 'object' ? (l.target as GNode).id : String(l.target)
      if (s === selected) set.add(t)
      if (t === selected) set.add(s)
    })
    return set
  }, [selected, links])

  const edgeTypes = [...new Set(links.map((l) => l.type))]

  return (
    <div className={`graphbox${selected ? ' focused' : ''}`} ref={boxRef}>
      <svg className="graph" ref={svgRef} onPointerMove={(e) => {
        const n = dragRef.current
        if (!n) return
        const p = pos(e)
        n.fx = p.x; n.fy = p.y
      }} onPointerUp={() => {
        const n = dragRef.current
        if (n) { n.fx = null; n.fy = null }
        dragRef.current = null
      }}>
        {links.map((l, i) => {
          const s = l.source as GNode, t = l.target as GNode
          if (typeof l.source !== 'object' || typeof l.target !== 'object') return null
          const dim = related && !(related.has(s.id) && related.has(t.id))
          const mx = ((s.x || 0) + (t.x || 0)) / 2, my = ((s.y || 0) + (t.y || 0)) / 2
          return (
            <g key={i} opacity={dim ? 0.18 : 1}>
              <line x1={s.x} y1={s.y} x2={t.x} y2={t.y}
                stroke={relColor(l.type)} strokeWidth={1.6} strokeDasharray={l.type === '对抗' ? '7 4' : undefined} />
              <text x={mx} y={my} fontSize={11} textAnchor="middle" fill={relColor(l.type)}
                style={{ paintOrder: 'stroke', stroke: '#fbf8f0', strokeWidth: 4 }}>
                {l.label || l.type}
              </text>
            </g>
          )
        })}
        {nodes.map((n) => {
          const dim = related && !related.has(n.id)
          const isSel = selected === n.id
          const display = n.name.length > 5 ? n.name.slice(0, 4) + '…' : n.name
          return (
            <g key={n.id} transform={`translate(${n.x},${n.y})`} opacity={dim ? 0.25 : 1}
              style={{ cursor: 'pointer' }}
              onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); dragRef.current = n }}
              onClick={() => onSelect(isSel ? null : n.id)}>
              <circle r={n.kind === 'char' ? 20 : 15}
                fill={n.kind === 'char' ? (isSel ? '#a8433a' : '#fbf8f0') : '#e9dfc8'}
                stroke={isSel ? '#a8433a' : (n.kind === 'char' ? '#5c5548' : '#b98a45')}
                strokeWidth={isSel ? 2.5 : 1.3}>
                <title>{n.name}{n.role ? `（${n.role}）` : ''}</title>
              </circle>
              <text y={4} fontSize={n.kind === 'char' ? 12 : 10.5} textAnchor="middle"
                fill={isSel ? '#fff' : '#2f2a22'} fontFamily={n.kind === 'char' ? undefined : 'var(--kai)'}>
                {display}
              </text>
            </g>
          )
        })}
      </svg>
      <div className="legend">
        <span className="lg-t">关系类型</span>
        {edgeTypes.map((t) => (
          <span key={t} className="lg-i">
            <svg width={26} height={8}><line x1={0} y1={4} x2={26} y2={4} stroke={relColor(t)} strokeWidth={2}
              strokeDasharray={t === '对抗' ? '5 3' : undefined} /></svg>{t}
          </span>
        ))}
        <span className="lg-i">○ 人物 · ◦ 世界观实体</span>
      </div>
    </div>
  )
}

/* ---------- 人物档案 ---------- */
function CharProfile({ char, rels, chars, worlds, onEdit, onChanged }: {
  char: Character; rels: Relation[]; chars: Character[]; worlds: WorldEntry[]
  onEdit: () => void; onChanged: () => Promise<void>
}) {
  const nameOf = (kind: string, id: number) => kind === 'char'
    ? chars.find((c) => c.id === id)?.name || '?'
    : worlds.find((w) => w.id === id)?.name || '?'

  async function removeChar() {
    if (!confirm(`删除人物「${char.name}」？`)) return
    await api.del(`/characters/${char.id}`)
    await onChanged()
  }

  const rows: Array<[string, string | undefined]> = [
    ['外在形象', char.appearance], ['表层动机（想要什么）', char.surface_goal],
    ['深层需要（真正需要什么）', char.deep_need], ['深层秘密', char.secret],
    ['人物弧光', char.arc],
  ]

  return (
    <aside className="profile">
      <div className="pf-hd">
        <span className="pf-seal">{char.name[0]}</span>
        <div>
          <h3>{char.name}</h3>
          <span className="pf-role">{char.role || '未定位'} · {char.gender || '—'}</span>
        </div>
        <span style={{ flex: 1 }} />
        <button className="btn sm" onClick={onEdit}>编辑</button>
        <button className="btn sm danger" onClick={removeChar}>删除</button>
      </div>
      {rows.map(([k, v]) => (
        <div key={k} className="pf-field">
          <span className="lb">{k}</span>
          <span className={`vl${k.includes('秘密') || k.includes('弧光') ? ' kai' : ''}`}>{v || '（待补）'}</span>
        </div>
      ))}
      <div className="pf-duel">
        <div className="cell"><b>表层动机</b>{char.surface_goal || '—'}</div>
        <div className="cell"><b>深层需要</b>{char.deep_need || '—'}</div>
      </div>
      <div className="pf-field">
        <span className="lb">关系（{rels.length}）</span>
        {rels.length === 0 ? <span className="vl dim">暂无关系</span> : rels.map((r) => {
          const other = `${r.src_kind}:${r.src_id}` === `char:${char.id}`
            ? nameOf(r.dst_kind, r.dst_id) : nameOf(r.src_kind, r.src_id)
          return (
            <div key={r.id} className="row" style={{ padding: '4px 6px' }}>
              <span className="tag" style={{ borderColor: relColor(r.type), color: relColor(r.type) }}>{r.type}</span>
              <span className="r-main"><span className="r-t">{other}</span></span>
              <button className="icon-btn" title="删除关系"
                onClick={async () => { await api.del(`/relations/${r.id}`); await onChanged() }}>✕</button>
            </div>
          )
        })}
      </div>
    </aside>
  )
}

/* ---------- 人物编辑 ---------- */
function CharModal({ project, char, onClose, onSaved }: {
  project: Project; char: Character | null; onClose: () => void; onSaved: () => void
}) {
  const [f, setF] = useState({
    name: char?.name || '', gender: char?.gender || '', role: char?.role || '',
    appearance: char?.appearance || '', surface_goal: char?.surface_goal || '',
    deep_need: char?.deep_need || '', secret: char?.secret || '', arc: char?.arc || '',
  })
  const set = (k: string) => (e: any) => setF((cur) => ({ ...cur, [k]: e.target.value }))

  async function save() {
    if (!f.name.trim()) return
    const payload = { ...f, name: f.name.trim(), aliases: char?.aliases || [] }
    if (char) await api.patch(`/characters/${char.id}`, payload)
    else await api.post('/characters', { project_id: project.id, ...payload })
    onSaved()
  }

  return (
    <Modal title={char ? `编辑人物：${char.name}` : '新人物'} onClose={onClose}>
      <div style={{ display: 'flex', gap: 10 }}>
        <label className="field" style={{ flex: 2 }}><span>姓名</span>
          <input className="input" value={f.name} onChange={set('name')} /></label>
        <label className="field" style={{ flex: 1 }}><span>性别</span>
          <select className="select" value={f.gender} onChange={set('gender')}>
            <option value="">—</option><option>男</option><option>女</option></select></label>
        <label className="field" style={{ flex: 1 }}><span>定位</span>
          <input className="input" value={f.role} onChange={set('role')} placeholder="主角/对手…" /></label>
      </div>
      <label className="field"><span>外在形象</span>
        <textarea className="input" rows={2} value={f.appearance} onChange={set('appearance')} /></label>
      <label className="field"><span>表层动机——想要什么</span>
        <input className="input" value={f.surface_goal} onChange={set('surface_goal')} /></label>
      <label className="field"><span>深层需要——真正需要什么（与上条拉扯）</span>
        <input className="input" value={f.deep_need} onChange={set('deep_need')} /></label>
      <label className="field"><span>深层秘密</span>
        <input className="input" value={f.secret} onChange={set('secret')} /></label>
      <label className="field"><span>人物弧光</span>
        <input className="input" value={f.arc} onChange={set('arc')} /></label>
      <div className="actions">
        <button className="btn" onClick={onClose}>取消</button>
        <button className="btn primary" disabled={!f.name.trim()} onClick={save}>保存</button>
      </div>
    </Modal>
  )
}

/* ---------- 关系编辑（边类型自由文本） ---------- */
function RelModal({ project, chars, worlds, onClose, onSaved }: {
  project: Project; chars: Character[]; worlds: WorldEntry[]
  onClose: () => void; onSaved: () => void
}) {
  const [src, setSrc] = useState('')
  const [dst, setDst] = useState('')
  const [type, setType] = useState('亲和')
  const [label, setLabel] = useState('')
  const opts = [
    ...chars.map((c) => ({ v: `char:${c.id}`, t: `人物·${c.name}` })),
    ...worlds.map((w) => ({ v: `world:${w.id}`, t: `${w.category}·${w.name}` })),
  ]

  async function save() {
    if (!src || !dst || !type.trim()) return
    const [sk, si] = src.split(':'), [dk, di] = dst.split(':')
    await api.post('/relations', {
      project_id: project.id, src_kind: sk, src_id: +si, dst_kind: dk, dst_id: +di,
      type: type.trim(), label: label || null,
    })
    onSaved()
  }

  return (
    <Modal title="结一段关系" onClose={onClose}>
      <label className="field"><span>一端</span>
        <select className="select" value={src} onChange={(e) => setSrc(e.target.value)}>
          <option value="">选择…</option>
          {opts.map((o) => <option key={o.v} value={o.v}>{o.t}</option>)}
        </select></label>
      <label className="field"><span>另一端</span>
        <select className="select" value={dst} onChange={(e) => setDst(e.target.value)}>
          <option value="">选择…</option>
          {opts.filter((o) => o.v !== src).map((o) => <option key={o.v} value={o.v}>{o.t}</option>)}
        </select></label>
      <div style={{ display: 'flex', gap: 10 }}>
        <label className="field" style={{ flex: 1 }}><span>关系类型（自由填写）</span>
          <input className="input" value={type} onChange={(e) => setType(e.target.value)}
            placeholder="血缘/师徒/宿敌/欠债…" /></label>
        <label className="field" style={{ flex: 1 }}><span>标签（可选）</span>
          <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} /></label>
      </div>
      <div className="actions">
        <button className="btn" onClick={onClose}>取消</button>
        <button className="btn primary" disabled={!src || !dst || !type.trim()} onClick={save}>结下</button>
      </div>
    </Modal>
  )
}
