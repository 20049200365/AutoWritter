/* 世界观设定库：分类导航（上下文栏）+ 卡片网格 + 所见即所得编辑（标记对齐参考模板） */
import { useEffect, useState } from 'react'
import { api, Project, WORLD_CATS, WorldEntry } from '../api'
import { Empty, Modal } from '../ui'

const CAT_TAG: Record<string, string> = {
  地理: 'qing', 势力: 'seal', 力量体系: 'zi', 器物: 'zhe', 名词: 'tie', 习俗: 'lv', 档案: 'tie',
}

export default function WorldPage({ project, onChanged }: {
  project: Project; onChanged: () => void
}) {
  const [entries, setEntries] = useState<WorldEntry[]>([])
  const [cat, setCat] = useState<string>('全部')
  const [editing, setEditing] = useState<WorldEntry | 'new' | null>(null)

  const load = () => api.get<WorldEntry[]>(`/world-entries?project_id=${project.id}`).then(setEntries)
  useEffect(() => { load() }, [project.id])

  const shown = cat === '全部' ? entries : entries.filter((e) => e.category === cat)

  async function remove(e: WorldEntry) {
    if (!confirm(`删除词条「${e.name}」？`)) return
    await api.del(`/world-entries/${e.id}`)
    await load(); onChanged()
  }

  return (
    <div className="split">
      {/* 分类导航（上下文栏） */}
      <aside id="colCtx">
        <div className="ctx-hd">
          <h4>设 定 分 类</h4>
          <span className="dim mono">{entries.length} 条</span>
        </div>
        <div className="ctx-body cat-nav">
          {['全部', ...WORLD_CATS].map((c) => (
            <button key={c} className={`row${cat === c ? ' on' : ''}`} onClick={() => setCat(c)}>
              <span className="r-main"><span className="r-t">{c}</span></span>
              <span className="cnt">{c === '全部' ? entries.length : entries.filter((e) => e.category === c).length}</span>
            </button>
          ))}
          <div style={{ padding: '10px 10px 0' }}>
            <button className="btn primary sm" onClick={() => setEditing('new')}>＋ 新词条</button>
          </div>
        </div>
      </aside>

      {/* 卡片网格 */}
      <div className="col-main-inner" style={{ overflowY: 'auto' }}>
        {shown.length === 0 ? (
          <Empty glyph="设" text="这一类还没有设定" actionText="写第一条" onAction={() => setEditing('new')} />
        ) : (
          <div className="world-grid">
            {shown.map((e) => (
              <div key={e.id} className="card world-card" onClick={() => setEditing(e)}>
                <h5>
                  <span className={`tag ${CAT_TAG[e.category] || ''}`}>{e.category}</span>
                  {e.name}
                  <span style={{ flex: 1 }} />
                  <button className="icon-btn row-act" title="删除"
                    onClick={(ev) => { ev.stopPropagation(); remove(e) }}>✕</button>
                </h5>
                <p className="wc-brief">{e.content || '（空）'}</p>
                <p className="wc-taboo">好设定的标准：什么事不能做，做了会怎样。</p>
              </div>
            ))}
          </div>
        )}
      </div>

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
      <div className="f-grid">
        <div className="f-row"><label>名称</label>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="f-row"><label>分类</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {WORLD_CATS.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
      </div>
      <div className="f-row"><label>内容（写清约束：什么不能做，做了会怎样）</label>
        <textarea rows={7} value={content} onChange={(e) => setContent(e.target.value)} />
      </div>
      <div className="m-acts">
        <button className="btn" onClick={onClose}>取消</button>
        <button className="btn primary" disabled={!name.trim()} onClick={save}>保存</button>
      </div>
    </Modal>
  )
}
