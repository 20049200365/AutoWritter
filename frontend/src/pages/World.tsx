/* 世界观设定库（M7 §9.2 页面 6）：分类导航 + 卡片网格 + 所见即所得编辑 */
import { useEffect, useState } from 'react'
import { api, Project, WORLD_CATS, WorldEntry } from '../api'
import { Empty, Modal } from '../ui'

export default function WorldPage({ project, onChanged }: {
  project: Project; onChanged: () => void
}) {
  const [entries, setEntries] = useState<WorldEntry[]>([])
  const [cat, setCat] = useState<string>('全部')
  const [editing, setEditing] = useState<WorldEntry | 'new' | null>(null)
  const [open, setOpen] = useState<number | null>(null)

  const load = () => api.get<WorldEntry[]>(`/world-entries?project_id=${project.id}`).then(setEntries)
  useEffect(() => { load() }, [project.id])

  const shown = cat === '全部' ? entries : entries.filter((e) => e.category === cat)

  async function remove(e: WorldEntry) {
    if (!confirm(`删除词条「${e.name}」？`)) return
    await api.del(`/world-entries/${e.id}`)
    await load(); onChanged()
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        {['全部', ...WORLD_CATS].map((c) => (
          <button key={c} className={`pill${cat === c ? ' seal' : ''}`} onClick={() => setCat(c)}>
            {c}{c !== '全部' && ` ${entries.filter((e) => e.category === c).length}`}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <button className="btn primary" onClick={() => setEditing('new')}>＋ 新词条</button>
      </div>

      {shown.length === 0 ? (
        <Empty text="这一类还没有设定" actionText="写第一条" onAction={() => setEditing('new')} />
      ) : (
        <div className="grid cols-3">
          {shown.map((e) => (
            <div key={e.id} className="card" style={{ cursor: 'pointer' }}
              onClick={() => setOpen(open === e.id ? null : e.id)}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="pill violet">{e.category}</span>
                <strong>{e.name}</strong>
                <span style={{ flex: 1 }} />
                <button className="btn sm" onClick={(ev) => { ev.stopPropagation(); setEditing(e) }}>编辑</button>
                <button className="btn sm danger" onClick={(ev) => { ev.stopPropagation(); remove(e) }}>删</button>
              </div>
              <p style={{ marginTop: 8, fontSize: 13, color: 'var(--ink-2)', whiteSpace: 'pre-wrap' }}>
                {open === e.id ? (e.content || '（空）') : (e.content || '').slice(0, 60) + ((e.content || '').length > 60 ? '…' : '')}
              </p>
              <p className="hint kai" style={{ marginTop: 6 }}>
                好设定的标准：什么事不能做，做了会怎样。
              </p>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <EntryModal project={project} entry={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await load(); onChanged() }} />
      )}
    </div>
  )
}

function EntryModal({ project, entry, onClose, onSaved }: {
  project: Project; entry: WorldEntry | null; onClose: () => void; onSaved: () => void
}) {
  const [name, setName] = useState(entry?.name || '')
  const [category, setCategory] = useState(entry?.category || WORLD_CATS[0])
  const [content, setContent] = useState(entry?.content || '')

  async function save() {
    if (!name.trim()) return
    if (entry) {
      await api.patch(`/world-entries/${entry.id}`, { name: name.trim(), category, content })
    } else {
      await api.post('/world-entries', { project_id: project.id, name: name.trim(), category, content, tags: [] })
    }
    onSaved()
  }

  return (
    <Modal title={entry ? `编辑词条：${entry.name}` : '新设定词条'} onClose={onClose}>
      <div style={{ display: 'flex', gap: 10 }}>
        <label className="field" style={{ flex: 2 }}><span>名称</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field" style={{ flex: 1 }}><span>分类</span>
          <select className="select" value={category} onChange={(e) => setCategory(e.target.value)}>
            {WORLD_CATS.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
      </div>
      <label className="field"><span>内容（写清约束：什么不能做，做了会怎样）</span>
        <textarea className="input" rows={7} value={content} onChange={(e) => setContent(e.target.value)} />
      </label>
      <div className="actions">
        <button className="btn" onClick={onClose}>取消</button>
        <button className="btn primary" disabled={!name.trim()} onClick={save}>保存</button>
      </div>
    </Modal>
  )
}
