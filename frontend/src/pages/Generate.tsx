/* 章生成工作台（M7 §9.2 页面 8）：两阶段流水线可视化
   装配账本 → 细纲确认（提议徽标）→ 扩写流式 → 评审雷达 → 接受/驳回 */
import { useEffect, useMemo, useState } from 'react'
import { api, Chapter, Project, sseStream } from '../api'
import { Empty } from '../ui'

const STAGES = ['装配', '细纲', '细纲确认', '扩写', '评审', '待决策'] as const
const REJECT_TAGS = ['节奏问题', '文风不合', '逻辑硬伤', '人物失真', '情节方向不对', '偏离大纲']
const DIMS = ['情节连贯', '人物一致性', '伏笔照应', '节奏', '文风贴合']

interface LedgerItem { layer: string; name: string; tokens: number; status: string }
interface Review {
  scores: Record<string, number>; overall: number
  issues: Array<{ level: string; type: string; detail: string }>
  revision_suggestions: string[]
}

export default function GeneratePage({ project, onChanged }: {
  project: Project; onChanged: () => void
}) {
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [chId, setChId] = useState<number | null>(null)
  const [stage, setStage] = useState<string>('')
  const [ledger, setLedger] = useState<LedgerItem[]>([])
  const [skillsInj, setSkillsInj] = useState<string[]>([])
  const [plan, setPlan] = useState<string>('')
  const [planDraft, setPlanDraft] = useState<string>('')
  const [taskId, setTaskId] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [review, setReview] = useState<Review | null>(null)
  const [rejecting, setRejecting] = useState(false)
  const [tags, setTags] = useState<string[]>([])
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [showLedger, setShowLedger] = useState(false)

  useEffect(() => {
    api.get<Chapter[]>(`/projects/${project.id}/chapters`).then((cs) => {
      cs.sort((a, b) => a.seq - b.seq)
      setChapters(cs)
      setChId((cur) => cur ?? cs[0]?.id ?? null)
    })
  }, [project.id])

  function reset() {
    setStage(''); setLedger([]); setSkillsInj([]); setPlan(''); setPlanDraft('')
    setTaskId(null); setDraft(''); setReview(null); setError(''); setTags([]); setNote('')
  }

  async function generate() {
    if (chId == null) return
    reset(); setStreaming(true); setError('')
    try {
      for await (const ev of sseStream(`/chapters/${chId}/generate`, {})) {
        handleEvent(ev)
        const s = ev.data?.stage
        if (ev.event === 'done' && ev.data?.stage === '细纲确认中') { setStage('细纲确认'); break }
        if (ev.event === 'done') { setStage('待决策'); break }
      }
    } catch (e: any) { setError(e.message) }
    setStreaming(false)
  }

  async function confirmPlan() {
    if (taskId == null) return
    setStreaming(true); setError(''); setStage('扩写')
    try {
      for await (const ev of sseStream(`/tasks/${taskId}/confirm-plan`, { plan_edited: planDraft })) {
        handleEvent(ev)
        if (ev.event === 'done') { setStage('待决策'); break }
      }
    } catch (e: any) { setError(e.message) }
    setStreaming(false)
  }

  function handleEvent(ev: { event: string; data: any }) {
    const d = ev.data || {}
    if (ev.event === 'progress') setStage(d.stage || '')
    else if (ev.event === 'context_ready') { setLedger(d.ledger || []); setSkillsInj(d.skills || []) }
    else if (ev.event === 'plan_ready') { setTaskId(d.task_id); setPlan(d.plan); setPlanDraft(d.plan); setStage('细纲确认') }
    else if (ev.event === 'token') { setDraft((cur) => cur + d.delta); setStage('扩写') }
    else if (ev.event === 'review') { setReview(d.review); setStage('待决策') }
    else if (ev.event === 'error') setError(d.message || '生成失败')
  }

  async function decide(decision: 'accept' | 'reject') {
    if (taskId == null) return
    if (decision === 'reject' && !rejecting) { setRejecting(true); return }
    await api.post(`/tasks/${taskId}/decide`, {
      decision, tags: decision === 'reject' ? tags : null,
      note: decision === 'reject' ? (note || null) : null,
    })
    setRejecting(false)
    onChanged()
    if (decision === 'accept') {
      setStage('已接受')
    } else {
      setStage('已驳回')
    }
  }

  async function resume() {
    if (taskId == null) return
    reset(); setStreaming(true)
    try {
      for await (const ev of sseStream(`/tasks/${taskId}/resume`)) {
        handleEvent(ev)
        if (ev.event === 'done' && ev.data?.stage === '细纲确认中') { setStage('细纲确认'); break }
      }
    } catch (e: any) { setError(e.message) }
    setStreaming(false)
  }

  const totalTokens = useMemo(() => ledger.reduce((s, i) => s + i.tokens, 0), [ledger])
  const ch = chapters.find((c) => c.id === chId)

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, alignItems: 'center' }}>
        <select className="select" style={{ width: 240 }} value={chId ?? ''}
          onChange={(e) => { setChId(+e.target.value); reset() }}>
          {chapters.map((c) => <option key={c.id} value={c.id}>CH.{String(c.seq).padStart(2, '0')} {c.title}</option>)}
        </select>
        <button className="btn primary" disabled={streaming || chId == null} onClick={generate}>
          {streaming ? '生成中…' : '生成本章'}
        </button>
        {stage === '已驳回' && (
          <button className="btn" onClick={resume}>开新一轮重生成</button>
        )}
        <span style={{ flex: 1 }} />
        {ch && !ch.text && !stage && <span className="hint kai">本章尚无正文，可在此起草</span>}
      </div>

      {/* 阶段条 */}
      {stage && (
        <div className="stage-bar">
          {STAGES.map((s) => {
            const doneIdx = STAGES.indexOf(stage as any)
            const myIdx = STAGES.indexOf(s)
            return (
              <span key={s} className={`stage${stage === s ? ' on' : ''}${doneIdx > myIdx ? ' done' : ''}`}>{s}</span>
            )
          })}
          {(stage === '已接受' || stage === '已驳回') && <span className="stage on">{stage}</span>}
        </div>
      )}

      {error && <div className="card" style={{ borderColor: 'var(--seal)', color: 'var(--seal)', marginBottom: 12 }}>{error}</div>}

      {/* 装配账本 */}
      {ledger.length > 0 && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }} onClick={() => setShowLedger(!showLedger)}>
            <strong style={{ fontSize: 13 }}>本章 AI 看到了什么</strong>
            <span className="hint mono" style={{ marginLeft: 10 }}>
              {ledger.length} 条材料 · ≈{totalTokens.toLocaleString()} tokens
            </span>
            {skillsInj.length > 0 && (
              <span style={{ marginLeft: 10 }}>
                {skillsInj.map((s) => <span key={s} className="pill violet" style={{ marginRight: 4 }}>Skill·{s}</span>)}
              </span>
            )}
            <span style={{ flex: 1 }} />
            <span className="hint">{showLedger ? '收起 ▲' : '展开 ▼'}</span>
          </div>
          {showLedger && (
            <div className="ledger" style={{ marginTop: 8 }}>
              {ledger.map((it, i) => (
                <div className="item" key={i}>
                  <span className="pill">{it.layer}</span>
                  <span style={{ flex: 1 }}>{it.name}</span>
                  <span className="mono hint">{it.tokens}</span>
                  <span className={`pill ${it.status === '装入' ? 'leaf' : 'ochre'}`}>{it.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 细纲确认 */}
      {stage === '细纲确认' && plan && (
        <div className="card" style={{ marginBottom: 12 }}>
          <h3 style={{ fontSize: 14, marginBottom: 8 }}>细纲（可改，AI 提议请甄别）</h3>
          <textarea className="input plan-editor" rows={9} value={planDraft}
            onChange={(e) => setPlanDraft(e.target.value)} />
          <div className="actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
            <button className="btn primary" disabled={streaming} onClick={confirmPlan}>确认，开始扩写</button>
          </div>
        </div>
      )}

      {/* 扩写流式 */}
      {(stage === '扩写' || draft) && (
        <div className="card" style={{ marginBottom: 12 }}>
          <h3 style={{ fontSize: 14, marginBottom: 8 }}>草稿{streaming && stage === '扩写' ? '（生成中…）' : ''}</h3>
          <div className={`prose${streaming && stage === '扩写' ? ' cursor-blink' : ''}`}
            style={{ whiteSpace: 'pre-wrap' }}>{draft}</div>
        </div>
      )}

      {/* 评审 */}
      {review && (
        <div className="card" style={{ marginBottom: 12 }}>
          <h3 style={{ fontSize: 14, marginBottom: 10 }}>评审 · 综合 {review.overall} 分</h3>
          <div className="radar-box">
            <Radar scores={review.scores} />
            <div style={{ flex: 1, minWidth: 260 }}>
              {review.issues.map((iss, i) => (
                <p key={i} style={{ fontSize: 12.5, marginBottom: 6 }}>
                  <span className={`pill ${iss.level === '高' ? 'seal' : iss.level === '中' ? 'ochre' : ''}`}>{iss.level}</span>{' '}
                  <strong>{iss.type}</strong>：{iss.detail}
                </p>
              ))}
              {review.revision_suggestions.length > 0 && (
                <p className="hint kai">建议：{review.revision_suggestions.join('；')}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 决策 */}
      {stage === '待决策' && (
        <div className="card">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn primary" onClick={() => decide('accept')}>接受，定稿</button>
            <button className="btn danger" onClick={() => decide('reject')}>驳回</button>
            {rejecting && (
              <span style={{ display: 'inline-flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
                {REJECT_TAGS.map((t) => (
                  <button key={t} className={`pill${tags.includes(t) ? ' seal' : ''}`}
                    onClick={() => setTags((cur) => cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t])}>
                    {t}
                  </button>
                ))}
                <input className="input" style={{ width: 180 }} placeholder="补充意见…"
                  value={note} onChange={(e) => setNote(e.target.value)} />
                <button className="btn danger sm" onClick={() => decide('reject')}>确认驳回</button>
              </span>
            )}
          </div>
        </div>
      )}

      {!stage && chapters.length === 0 && (
        <Empty text="先在正文页开一章，再回来生成" />
      )}
    </div>
  )
}

/* ---------- 五维雷达图（手写 SVG） ---------- */
function Radar({ scores }: { scores: Record<string, number> }) {
  const size = 180, cx = size / 2, cy = size / 2, R = 62
  const pts = DIMS.map((d, i) => {
    const ang = (Math.PI * 2 * i) / DIMS.length - Math.PI / 2
    return { d, ang }
  })
  const poly = pts.map(({ d, ang }) => {
    const r = (R * Math.min(10, scores[d] ?? 0)) / 10
    return `${cx + r * Math.cos(ang)},${cy + r * Math.sin(ang)}`
  }).join(' ')
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <polygon key={f} fill="none" stroke="var(--line-2)" strokeWidth={0.8}
          points={pts.map(({ ang }) => `${cx + R * f * Math.cos(ang)},${cy + R * f * Math.sin(ang)}`).join(' ')} />
      ))}
      {pts.map(({ d, ang }) => (
        <g key={d}>
          <line x1={cx} y1={cy} x2={cx + R * Math.cos(ang)} y2={cy + R * Math.sin(ang)}
            stroke="var(--line)" strokeWidth={0.8} />
          <text x={cx + (R + 14) * Math.cos(ang)} y={cy + (R + 14) * Math.sin(ang)}
            fontSize={10} textAnchor="middle" fill="var(--ink-2)">{d}</text>
        </g>
      ))}
      <polygon points={poly} fill="rgba(168,67,58,.18)" stroke="var(--seal)" strokeWidth={1.6} />
    </svg>
  )
}
