/* 时间线 + 创作看板（M7 §9.2 页面 7）：数据全部来自后端 stats/列表接口 */
import { useEffect, useMemo, useState } from 'react'
import { api, Chapter, Project, Stats, TimelineEvent } from '../api'
import { Empty } from '../ui'

export default function BoardPage({ project, stats }: { project: Project; stats: Stats | null }) {
  const [events, setEvents] = useState<TimelineEvent[]>([])
  const [chapters, setChapters] = useState<Chapter[]>([])

  useEffect(() => {
    api.get<TimelineEvent[]>(`/timeline-events?project_id=${project.id}`).then(setEvents).catch(() => setEvents([]))
    api.get<Chapter[]>(`/projects/${project.id}/chapters`).then(setChapters).catch(() => setChapters([]))
  }, [project.id])

  return (
    <div className="page-pad">
      {/* 统计卡 */}
      <div className="stat-cards">
        <StatCard n={stats?.written ?? 0} l={`已写章 / 计划 ${stats?.plan ?? 0}`} />
        <StatCard n={(stats?.words ?? 0).toLocaleString()} l="总字数" />
        <StatCard n={`${stats?.fspDone ?? 0}/${stats?.fsp ?? 0}`} l={`伏笔回收（悬空 ${stats?.fspDangling ?? 0}）`} />
        <StatCard n={stats?.chars ?? 0} l="人物" />
      </div>

      {/* 时间线 */}
      <div className="card" style={{ marginBottom: 14 }}>
        <h2 className="h2">时间线（主线 / 人物 / 伏笔）</h2>
        {events.length === 0 ? (
          <Empty text="章节定稿后，AI 会提议时间线事件（在「AI 提议」会话采纳）" />
        ) : (
          <Timeline events={events} chapters={chapters} />
        )}
      </div>

      {/* 图表 */}
      <div className="grid cols-2">
        <div className="chart-card">
          <h2 className="h2">各章字数</h2>
          <BarChart chapters={chapters} />
        </div>
        <div className="chart-card">
          <h2 className="h2">写作进度</h2>
          <ProgressRing stats={stats} />
        </div>
      </div>
    </div>
  )
}

function StatCard({ n, l }: { n: string | number; l: string }) {
  return <div className="stat-card"><div className="n">{n}</div><div className="l">{l}</div></div>
}

/* ---------- 多轨时间线 ---------- */
function Timeline({ events, chapters }: { events: TimelineEvent[]; chapters: Chapter[] }) {
  const tracks = useMemo(() => {
    const map = new Map<string, TimelineEvent[]>()
    events.forEach((e) => {
      const arr = map.get(e.track) || []
      arr.push(e)
      map.set(e.track, arr)
    })
    return [...map.entries()].sort(([a], [b]) => (a === 'main' ? -1 : b === 'main' ? 1 : a.localeCompare(b)))
  }, [events])
  const seqOf = (chapterId?: number) => chapters.find((c) => c.id === chapterId)?.seq

  return (
    <div className="timeline-box" style={{ padding: 14 }}>
      {tracks.map(([track, evs]) => (
        <div key={track} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <span className="pill" style={{ width: 90, textAlign: 'center', flex: 'none' }}>
            {track === 'main' ? '主线' : track.startsWith('char:') ? `人物#${track.slice(5)}` : '伏笔'}
          </span>
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', flex: 1, padding: '4px 0' }}>
            {evs.sort((a, b) => a.sort - b.sort).map((e) => (
              <span key={e.id} className="pill" style={{ flex: 'none' }}
                title={e.description || ''}>
                {seqOf(e.chapter_id) ? `CH.${String(seqOf(e.chapter_id)).padStart(2, '0')} · ` : ''}{e.title}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

/* ---------- 各章字数柱状图（手写 SVG，轴标签独立留白） ---------- */
function BarChart({ chapters }: { chapters: Chapter[] }) {
  const data = chapters.filter((c) => c.word_count > 0)
  if (data.length === 0) return <p className="hint">暂无字数数据</p>
  const W = 440, H = 150, padL = 42, padB = 22
  const max = Math.max(...data.map((c) => c.word_count), 1)
  const bw = Math.min(26, (W - padL) / data.length - 4)
  return (
    <svg viewBox={`0 0 ${W} ${H}`}>
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line x1={padL} x2={W} y1={H - padB - f * (H - padB - 8)} y2={H - padB - f * (H - padB - 8)}
            stroke="var(--line)" strokeWidth={0.7} />
          <text x={padL - 5} y={H - padB - f * (H - padB - 8) + 3} fontSize={9}
            textAnchor="end" fill="var(--ink-3)" fontFamily="var(--mono)">
            {Math.round(max * f)}
          </text>
        </g>
      ))}
      {data.map((c, i) => {
        const h = (c.word_count / max) * (H - padB - 8)
        return (
          <g key={c.id}>
            <rect x={padL + i * ((W - padL) / data.length) + 2} y={H - padB - h}
              width={bw} height={h} fill={c.status === '定稿' ? 'var(--seal)' : 'var(--ochre)'} rx={2}>
              <title>CH.{c.seq} {c.word_count} 字</title>
            </rect>
            <text x={padL + i * ((W - padL) / data.length) + 2 + bw / 2} y={H - padB + 12}
              fontSize={8.5} textAnchor="middle" fill="var(--ink-3)" fontFamily="var(--mono)">
              {c.seq}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

/* ---------- 目标进度环 ---------- */
function ProgressRing({ stats }: { stats: Stats | null }) {
  const target = 200000
  const pct = Math.min(1, (stats?.words ?? 0) / target)
  const R = 52, C = 2 * Math.PI * R
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
      <svg width={140} height={140} viewBox="0 0 140 140">
        <circle cx={70} cy={70} r={R} fill="none" stroke="var(--paper-2)" strokeWidth={12} />
        <circle cx={70} cy={70} r={R} fill="none" stroke="var(--seal)" strokeWidth={12}
          strokeDasharray={`${C * pct} ${C}`} strokeLinecap="round"
          transform="rotate(-90 70 70)" />
        <text x={70} y={66} textAnchor="middle" fontSize={20} fontFamily="var(--mono)" fill="var(--ink)">
          {(pct * 100).toFixed(1)}%
        </text>
        <text x={70} y={84} textAnchor="middle" fontSize={10} fill="var(--ink-3)">目标 {target.toLocaleString()} 字</text>
      </svg>
      <div>
        <p style={{ fontSize: 13 }}>已写 <strong className="mono">{(stats?.words ?? 0).toLocaleString()}</strong> 字</p>
        <p className="hint" style={{ marginTop: 4 }}>章完成度 {stats?.written ?? 0}/{stats?.plan ?? 0}，缺口 {stats?.gap ?? 0} 章</p>
      </div>
    </div>
  )
}
