/* 时间线 + 创作看板（对齐参考模板模块 7）：多轨横向时间线 + 4 种手写 SVG 图表
   数字全部由 /stats 与列表接口实时计算（M7 §1.2：前端不硬算统计口径） */
import { useEffect, useMemo, useState } from 'react'
import { api, Chapter, Character, fmtCh, OutlineNode, Project, Stats, TimelineEvent } from '../api'
import { Empty, Modal } from '../ui'

const TRACK_COLORS = ['#a8433a', '#40635c', '#b98a45', '#7c5f8f', '#6f8f62', '#55504a']
const trackColor = (i: number) => TRACK_COLORS[i % TRACK_COLORS.length]

export default function BoardPage({ project, stats, gotoChapter }: {
  project: Project; stats: Stats | null; gotoChapter?: (id: number) => void
}) {
  const [events, setEvents] = useState<TimelineEvent[]>([])
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [chars, setChars] = useState<Character[]>([])
  const [outline, setOutline] = useState<OutlineNode[]>([])
  const [tracksOff, setTracksOff] = useState<Record<string, boolean>>({})
  const [evOpen, setEvOpen] = useState<TimelineEvent | null>(null)

  useEffect(() => {
    Promise.all([
      api.get<TimelineEvent[]>(`/timeline-events?project_id=${project.id}`).catch(() => [] as TimelineEvent[]),
      api.get<Chapter[]>(`/projects/${project.id}/chapters`).catch(() => [] as Chapter[]),
      api.get<Character[]>(`/characters?project_id=${project.id}`).catch(() => [] as Character[]),
      api.get<OutlineNode[]>(`/projects/${project.id}/outline`).catch(() => [] as OutlineNode[]),
    ]).then(([evs, cs, chs, os]) => {
      setEvents(evs); setChapters(cs.sort((a, b) => a.seq - b.seq)); setChars(chs); setOutline(os)
    })
  }, [project.id])

  const tracks = useMemo(() => {
    const names = [...new Set(events.map((e) => e.track))]
    names.sort((a, b) => (a === 'main' ? -1 : b === 'main' ? 1 : a.localeCompare(b)))
    return names
  }, [events])

  /* 张力曲线数据：大纲叶子节点按树序拍平 */
  const leaves = useMemo(() => {
    const kids = (pid: number | null) => outline
      .filter((n) => n.parent_id === pid).sort((a, b) => a.sort - b.sort)
    const out: OutlineNode[] = []
    const walk = (pid: number | null) => {
      for (const n of kids(pid)) {
        const hasKids = outline.some((x) => x.parent_id === n.id)
        if (hasKids) walk(n.id)
        else out.push(n)
      }
    }
    walk(null)
    return out
  }, [outline])

  const seqOf = (chapterId?: number | null) => chapters.find((c) => c.id === chapterId)?.seq

  if (!events.length && !chapters.length && !leaves.length) {
    return (
      <Empty text="还没有时间线事件，看板也没有数据可算。写了章节、埋了伏笔之后，这里会自动长出来。" />
    )
  }

  return (
    <div className="split">
      {/* ---------- 轨道开关（上下文栏） ---------- */}
      <aside id="colCtx">
        <div className="ctx-hd"><h4>时间线轨道</h4></div>
        <div className="ctx-body">
          {tracks.length === 0 && <Empty text="暂无轨道" />}
          {tracks.map((t, i) => (
            <div key={t} className="row" style={{ cursor: 'default' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', flex: 1 }}>
                <input type="checkbox" checked={tracksOff[t] !== true}
                  onChange={(e) => setTracksOff((cur) => ({ ...cur, [t]: !e.target.checked }))} />
                <span className="r-t" style={{ fontSize: 13 }}>{trackName(t)}</span>
              </label>
              <span className="tag" style={{
                alignSelf: 'center', background: trackColor(i) + '22',
                color: trackColor(i), borderColor: trackColor(i) + '55',
              }}>{events.filter((e) => e.track === t).length}</span>
            </div>
          ))}
          <div style={{ padding: '14px 10px' }}>
            <div className="notice">时间线横向滚动；点事件节点看详情并可跳转章节。看板数字全部由当前数据实时计算。</div>
          </div>
        </div>
      </aside>

      {/* ---------- 看板主区 ---------- */}
      <div className="board-scroll">
        {/* 统计卡 */}
        <div className="statcards">
          <div className="card statcard"><span className="sc-v">{stats?.written ?? 0}/{stats?.plan ?? 0}</span><span className="sc-l">已写章 / 计划</span></div>
          <div className="card statcard"><span className="sc-v">{(stats?.words ?? 0).toLocaleString()}</span><span className="sc-l">总字数</span></div>
          <div className={`card statcard${(stats?.fspDangling ?? 0) > 0 ? ' warn' : ''}`}>
            <span className="sc-v">{stats?.fspDone ?? 0}/{stats?.fsp ?? 0}</span><span className="sc-l">伏笔回收（悬空 {stats?.fspDangling ?? 0}）</span></div>
          <div className="card statcard"><span className="sc-v">{stats?.chars ?? 0}</span><span className="sc-l">人物</span></div>
        </div>

        {/* 多轨时间线 */}
        {events.length > 0 && (
          <div className="card" style={{ padding: '12px 14px' }}>
            <div className="hd" style={{ padding: '0 0 8px', border: 'none' }}>
              <h3 style={{ fontSize: 13 }}>多轨时间线</h3>
              <span className="hint">横向滚动 · 点节点看详情</span>
            </div>
            <Timeline events={events.filter((e) => tracksOff[e.track] !== true)}
              tracks={tracks.filter((t) => tracksOff[t] !== true)}
              seqOf={seqOf} onOpen={setEvOpen} />
          </div>
        )}

        {/* 图表四件套 */}
        <div className="chartgrid">
          <div className="card chartbox">
            <h5>各章字数<span className="cb-sub">定稿=朱砂 · 其它=赭</span></h5>
            <BarChart chapters={chapters} />
          </div>
          <div className="card chartbox">
            <h5>章节张力曲线<span className="cb-sub">实心点 = 已定稿</span></h5>
            <TensionChart leaves={leaves} />
          </div>
          <div className="card chartbox">
            <h5>目标进度<span className="cb-sub">目标 {(project.target_words || 200000).toLocaleString()} 字</span></h5>
            <ProgressRing stats={stats} target={project.target_words || 200000} />
          </div>
          <div className="card chartbox">
            <h5>人物出场频次<span className="cb-sub">按已写正文中提及次数</span></h5>
            <FreqChart chars={chars} chapters={chapters} />
          </div>
        </div>
      </div>

      {/* 事件详情弹窗 */}
      {evOpen && (
        <Modal title={evOpen.title} onClose={() => setEvOpen(null)}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <span className="tag">{trackName(evOpen.track)}</span>
            {evOpen.time_label && <span className="tag zhe">{evOpen.time_label}</span>}
            {seqOf(evOpen.chapter_id) && <span className="tag seal">{fmtCh(seqOf(evOpen.chapter_id)!)}</span>}
          </div>
          <p style={{ fontSize: 13.5, lineHeight: 1.9, marginBottom: 14 }}>{evOpen.description || '（无详情）'}</p>
          <div className="m-acts">
            <button className="btn" onClick={() => setEvOpen(null)}>关闭</button>
            {evOpen.chapter_id && gotoChapter && (
              <button className="btn primary" onClick={() => {
                gotoChapter(evOpen.chapter_id!)
                setEvOpen(null)
              }}>跳到 {fmtCh(seqOf(evOpen.chapter_id)!)}</button>
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}

function trackName(t: string) {
  return t === 'main' ? '主线' : t.startsWith('char:') ? `人物·${t.slice(5)}` : t === 'fsp' ? '伏笔' : t
}

/* ---------- 多轨横向时间线（左侧留白不遮挡轨道名，E9） ---------- */
function Timeline({ events, tracks, seqOf, onOpen }: {
  events: TimelineEvent[]; tracks: string[]
  seqOf: (id?: number | null) => number | undefined; onOpen: (e: TimelineEvent) => void
}) {
  const leftPad = 130, per = 74, headerH = 26, rowH = 48
  const maxSort = Math.max(1, ...events.map((e) => e.sort))
  const W = leftPad + (maxSort + 1) * per + 40
  const H = headerH + tracks.length * rowH + 14
  /* 时代锚点：取 time_label 首次出现处 */
  const eras: Array<{ label: string; x: number }> = []
  for (const t of tracks) {
    for (const e of events.filter((x) => x.track === t).sort((a, b) => a.sort - b.sort)) {
      if (e.time_label && !eras.some((x) => x.label === e.time_label)) {
        eras.push({ label: e.time_label, x: leftPad + e.sort * per })
      }
    }
  }
  return (
    <div className="tl-outer">
      <div className="tl-canvas" style={{ width: W, height: H }}>
        {eras.map((a) => (
          <div key={a.label + a.x} className="tl-era" style={{ left: a.x }}>
            <span className="lb" style={{ left: 5 }}>{a.label}</span>
          </div>
        ))}
        {tracks.map((t, i) => {
          const cy = headerH + i * rowH + rowH / 2
          const color = trackColor(tracks.indexOf(t))
          return (
            <div key={t}>
              <div className="tl-track" style={{ top: cy }} />
              <div className="tl-trackname" style={{ position: 'absolute', left: 8, top: cy - 11, float: 'none' }}>{trackName(t)}</div>
              {events.filter((e) => e.track === t).sort((a, b) => a.sort - b.sort).map((e) => (
                <div key={e.id} className="tl-ev" style={{ left: leftPad + e.sort * per, top: cy, color }}
                  onClick={() => onOpen(e)}>
                  <span className="tip">{e.title}{seqOf(e.chapter_id) ? ` · ${fmtCh(seqOf(e.chapter_id)!)}` : ''}</span>
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ---------- 各章字数柱状图（坐标轴留白独立，不压数据，E9） ---------- */
function niceMax(v: number) {
  if (v <= 0) return 10
  const p = Math.pow(10, Math.floor(Math.log(v) / Math.LN10))
  const d = v / p
  return (d <= 1 ? 1 : d <= 2 ? 2 : d <= 5 ? 5 : 10) * p
}

function BarChart({ chapters }: { chapters: Chapter[] }) {
  const data = chapters.filter((c) => c.word_count > 0)
  if (data.length === 0) return <p className="hint" style={{ padding: 20, textAlign: 'center' }}>暂无字数数据</p>
  const W = 380, H = 170, L = 46, R = 8, T = 10, B = 26
  const iw = W - L - R, ih = H - T - B
  const mx = niceMax(Math.max(...data.map((c) => c.word_count)))
  const bw = iw / data.length
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`}>
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line className="grid-l" x1={L} x2={W - R} y1={T + ih - ih * f} y2={T + ih - ih * f} />
          <text x={L - 6} y={T + ih - ih * f + 3} textAnchor="end">{Math.round(mx * f)}</text>
        </g>
      ))}
      {data.map((c, i) => {
        const h = (c.word_count / mx) * ih
        return (
          <g key={c.id}>
            <rect x={L + i * bw + bw * 0.22} y={T + ih - h} width={bw * 0.56} height={h} rx={2}
              fill={c.status === '定稿' ? '#a8433a' : '#b98a45'} opacity={0.85}>
              <title>{fmtCh(c.seq)} {c.word_count} 字</title>
            </rect>
            <text x={L + i * bw + bw / 2} y={H - 8} textAnchor="middle">{c.seq}</text>
          </g>
        )
      })}
      <line className="axis" x1={L} y1={T + ih} x2={W - R} y2={T + ih} />
    </svg>
  )
}

/* ---------- 章节张力折线（大纲叶子节点） ---------- */
function TensionChart({ leaves }: { leaves: OutlineNode[] }) {
  const items = leaves.filter((n) => n.tension != null)
  if (items.length === 0) return <p className="hint" style={{ padding: 20, textAlign: 'center' }}>暂无大纲张力数据</p>
  const W = 380, H = 170, L = 40, R = 10, T = 12, B = 26
  const iw = W - L - R, ih = H - T - B
  const step = items.length > 1 ? iw / (items.length - 1) : 0
  const X = (i: number) => L + i * step
  const Y = (t: number) => T + ih - (t / 10) * ih
  const path = items.map((n, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(n.tension ?? 5).toFixed(1)}`).join(' ')
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`}>
      {[0, 5, 10].map((t) => (
        <g key={t}>
          <line className="grid-l" x1={L} x2={W - R} y1={Y(t)} y2={Y(t)} />
          <text x={L - 6} y={Y(t) + 3} textAnchor="end">{t}</text>
        </g>
      ))}
      <path d={path} fill="none" stroke="#40635c" strokeWidth={2} />
      {items.map((n, i) => (
        <g key={n.id}>
          <circle cx={X(i)} cy={Y(n.tension ?? 5)} r={3.4}
            fill={n.status === '定稿' ? '#a8433a' : '#fbf8f0'} stroke="#a8433a" strokeWidth={1.6}>
            <title>{n.title} · 张力 {n.tension} · {n.status}</title>
          </circle>
          {(i % 4 === 0 || i === items.length - 1) && (
            <text x={X(i)} y={H - 8} textAnchor="middle">{i + 1}</text>
          )}
        </g>
      ))}
    </svg>
  )
}

/* ---------- 目标进度环 ---------- */
function ProgressRing({ stats, target }: { stats: Stats | null; target: number }) {
  const words = stats?.words ?? 0
  const pct = Math.min(1, words / target)
  const C = 2 * Math.PI * 54
  return (
    <svg className="chart" viewBox="0 0 300 150">
      <g transform="translate(78,75)">
        <circle r={54} fill="none" stroke="#e9dfc8" strokeWidth={12} />
        <circle r={54} fill="none" stroke="#a8433a" strokeWidth={12} strokeLinecap="round"
          strokeDasharray={`${(C * pct).toFixed(1)} ${C.toFixed(1)}`} transform="rotate(-90)" />
        <text y={6} textAnchor="middle" style={{ fontSize: 18, fill: '#2f2a22', fontWeight: 700 }}>
          {Math.round(pct * 100)}%
        </text>
      </g>
      <g transform="translate(170,58)">
        <text style={{ fontSize: 11, fill: '#8d8574' }}>已写</text>
        <text x={96} textAnchor="end" style={{ fontSize: 13, fill: '#2f2a22' }}>{words.toLocaleString()}</text>
        <text y={24} style={{ fontSize: 11, fill: '#8d8574' }}>目标</text>
        <text x={96} y={24} textAnchor="end" style={{ fontSize: 13, fill: '#2f2a22' }}>{target.toLocaleString()}</text>
        <text y={48} style={{ fontSize: 11, fill: '#8d8574' }}>缺口</text>
        <text x={96} y={48} textAnchor="end" style={{ fontSize: 13, fill: '#a8433a' }}>
          {Math.max(0, target - words).toLocaleString()}
        </text>
      </g>
    </svg>
  )
}

/* ---------- 人物出场频次（正文提及次数实时统计） ---------- */
const CHAR_COLORS = ['#a8433a', '#40635c', '#7c5f8f', '#b98a45', '#6f8f62', '#55504a']
function FreqChart({ chars, chapters }: { chars: Character[]; chapters: Chapter[] }) {
  if (chars.length === 0) return <p className="hint" style={{ padding: 20, textAlign: 'center' }}>暂无人物</p>
  const texts = chapters.map((c) => c.text || '')
  const counts = chars.map((c, i) => {
    const names = [c.name, ...(c.aliases || [])].filter(Boolean)
    let n = 0
    for (const t of texts) for (const nm of names) {
      let pos = t.indexOf(nm)
      while (pos >= 0) { n++; pos = t.indexOf(nm, pos + nm.length) }
    }
    return { c, n, color: CHAR_COLORS[i % CHAR_COLORS.length] }
  }).sort((a, b) => b.n - a.n).slice(0, 10)
  const mx = Math.max(1, counts[0]?.n ?? 1)
  const rowH = 24, W = 380, L = 108, R = 40
  const H = counts.length * rowH + 12
  const iw = W - L - R
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`}>
      {counts.map((x, i) => {
        const y = 8 + i * rowH
        const w = (x.n / mx) * iw
        const nm = x.c.name.replace(/（[^）]*）/g, '').slice(0, 5)
        return (
          <g key={x.c.id}>
            <text x={L - 8} y={y + 13} textAnchor="end" style={{ fontSize: 11, fill: '#5c5548' }}>{nm}</text>
            <rect x={L} y={y + 4} width={Math.max(2, w)} height={12} rx={3} fill={x.color} opacity={0.82}>
              <title>{x.c.name} · 提及 {x.n} 次</title>
            </rect>
            <text x={L + w + 6} y={y + 13} style={{ fontSize: 11, fill: '#5c5548' }}>{x.n}</text>
          </g>
        )
      })}
    </svg>
  )
}
