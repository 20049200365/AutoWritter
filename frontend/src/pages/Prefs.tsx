/* 偏好档案（M7 §9.2 页面 10）：画像可视化 / 手动修正 / 事件时间线 / 回滚 */
import { useEffect, useState } from 'react'
import { api, Project } from '../api'
import { Empty } from '../ui'

interface Profile {
  project_id: number; version: number; likes: string[]; dislikes: string[]
  hard_constraints: string[]; rubric_weights: Record<string, number>
  source: string; snapshots: Array<{ version: number }>
}
interface PrefEvent { id: number; action: string; tags: string[]; feedback?: string; created_at: string }

export default function PrefsPage({ project, onChanged }: {
  project: Project; onChanged: () => void
}) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [events, setEvents] = useState<PrefEvent[]>([])
  const [newLike, setNewLike] = useState('')
  const [newDislike, setNewDislike] = useState('')

  const load = async () => {
    const [p, evs] = await Promise.all([
      api.get<Profile>(`/preferences/${project.id}`),
      api.get<PrefEvent[]>(`/preferences/${project.id}/events`),
    ])
    setProfile(p); setEvents(evs)
  }
  useEffect(() => { load() }, [project.id])

  async function save(patch: Partial<Profile>) {
    await api.put(`/preferences/${project.id}`, patch)
    await load(); onChanged()
  }

  if (!profile) return null
  const rate: Record<string, number> = profile.rubric_weights || {}

  return (
    <div className="grid cols-2" style={{ maxWidth: 980, margin: '0 auto' }}>
      <div>
        <div className="card" style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <h2 className="h2" style={{ marginBottom: 0 }}>用户画像 v{profile.version}</h2>
            <span className="pill" style={{ marginLeft: 8 }}>{profile.source === 'manual' ? '手动维护' : '自动蒸馏'}</span>
            <span style={{ flex: 1 }} />
            {profile.snapshots.length > 0 && (
              <select className="select" style={{ width: 130 }} value=""
                onChange={async (e) => {
                  if (!e.target.value) return
                  await api.post(`/preferences/${project.id}/rollback`, { version: +e.target.value })
                  await load()
                }}>
                <option value="">回滚到…</option>
                {profile.snapshots.map((s) => <option key={s.version} value={s.version}>v{s.version}</option>)}
              </select>
            )}
          </div>

          <h3 style={{ fontSize: 13, margin: '12px 0 6px' }}>喜欢</h3>
          <TagList items={profile.likes} onRemove={(x) =>
            save({ likes: profile.likes.filter((v) => v !== x) })} />
          <AddRow value={newLike} setValue={setNewLike} placeholder="加一条喜好…"
            onAdd={() => { if (newLike.trim()) { save({ likes: [...profile.likes, newLike.trim()] }); setNewLike('') } }} />

          <h3 style={{ fontSize: 13, margin: '12px 0 6px' }}>避免</h3>
          <TagList items={profile.dislikes} onRemove={(x) =>
            save({ dislikes: profile.dislikes.filter((v) => v !== x) })} />
          <AddRow value={newDislike} setValue={setNewDislike} placeholder="加一条雷区…"
            onAdd={() => { if (newDislike.trim()) { save({ dislikes: [...profile.dislikes, newDislike.trim()] }); setNewDislike('') } }} />

          <h3 style={{ fontSize: 13, margin: '12px 0 6px' }}>硬约束</h3>
          {profile.hard_constraints.length === 0 ? <p className="hint">暂无（连续驳回同类问题 3 次会自动升级）</p> : (
            profile.hard_constraints.map((h, i) => (
              <p key={i} style={{ fontSize: 12.5, marginBottom: 4 }}>
                <span className="pill seal">禁</span> {h}
              </p>
            ))
          )}

          {Object.keys(rate).length > 0 && (
            <>
              <h3 style={{ fontSize: 13, margin: '12px 0 6px' }}>评审权重</h3>
              {Object.entries(rate).map(([k, v]) => (
                <p key={k} className="mono hint" style={{ fontSize: 12 }}>{k}: ×{v}</p>
              ))}
            </>
          )}
        </div>
      </div>

      <div className="card">
        <h2 className="h2">接受 / 驳回事件</h2>
        {events.length === 0 ? (
          <Empty text="还没有决策记录——去生成一章并裁决" />
        ) : (
          <div className="row-list">
            {[...events].reverse().map((e) => (
              <div key={e.id} className="row-item">
                <span className={`pill ${e.action === 'accept' ? 'leaf' : 'seal'}`}>
                  {e.action === 'accept' ? '接受' : '驳回'}
                </span>
                <span className="grow">
                  <span className="t">{(e.tags || []).join('、') || '—'}</span>
                  {e.feedback && <span className="s" style={{ display: 'block' }}>{e.feedback}</span>}
                </span>
                <span className="mono hint" style={{ fontSize: 10 }}>
                  {new Date(e.created_at).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function TagList({ items, onRemove }: { items: string[]; onRemove: (x: string) => void }) {
  if (items.length === 0) return <p className="hint">（空）</p>
  return (
    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
      {items.map((x) => (
        <span key={x} className="pill" style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
          {x} <button className="icon-btn" style={{ padding: 0 }} onClick={() => onRemove(x)}>✕</button>
        </span>
      ))}
    </div>
  )
}

function AddRow({ value, setValue, placeholder, onAdd }: {
  value: string; setValue: (s: string) => void; placeholder: string; onAdd: () => void
}) {
  return (
    <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
      <input className="input" value={value} placeholder={placeholder}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && onAdd()} />
      <button className="btn sm" onClick={onAdd}>加</button>
    </div>
  )
}
