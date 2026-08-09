import { useCallback, useEffect, useState } from 'react'
import { api, GENRES, POVS, TONES, Project, Stats } from './api'
import { Empty, Modal, Toast, ToastMsg } from './ui'
import TextPage from './pages/Text'
import CharsPage from './pages/Chars'
import OutlinePage from './pages/Outline'
import WorldPage from './pages/World'
import BoardPage from './pages/Board'
import ChatPage from './pages/Chat'
import GeneratePage from './pages/Generate'
import SkillsPage from './pages/Skills'
import PrefsPage from './pages/Prefs'

const SPINE_COLORS = ['#40635c', '#7c5f8f', '#55504a', '#b98a45', '#a8433a', '#6f8f62']

const TABS = [
  { id: 'text', label: '正文' },
  { id: 'chars', label: '人物' },
  { id: 'outline', label: '大纲·伏笔' },
  { id: 'world', label: '世界观' },
  { id: 'board', label: '时间线·看板' },
  { id: 'chat', label: '对话' },
  { id: 'generate', label: '生成' },
  { id: 'skills', label: 'Skill' },
  { id: 'prefs', label: '偏好' },
] as const

type TabId = typeof TABS[number]['id']

export default function App() {
  const [projects, setProjects] = useState<Project[]>([])
  const [activeId, setActiveId] = useState<number | null>(null)
  const [tab, setTab] = useState<TabId>('text')
  const [stats, setStats] = useState<Stats | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [toast, setToast] = useState<ToastMsg | null>(null)
  const [refresh, setRefresh] = useState(0)

  const bump = useCallback(() => setRefresh((r) => r + 1), [])

  useEffect(() => {
    api.get<Project[]>('/projects').then((ps) => {
      setProjects(ps)
      setActiveId((cur) => cur ?? ps[0]?.id ?? null)
    }).catch(() => setToast({ text: '后端未连接：请先启动 python -m app（端口 8000）' }))
  }, [refresh])

  useEffect(() => {
    if (activeId == null) { setStats(null); return }
    api.get<Stats>(`/projects/${activeId}/stats`).then(setStats).catch(() => setStats(null))
  }, [activeId, refresh])

  const active = projects.find((p) => p.id === activeId) || null

  async function deleteProject(p: Project) {
    if (!confirm(`删除《${p.title}》？\n共 ${p.title ? '' : ''}该作品的全部数据将进入 5 秒撤销窗口。`)) return
    await api.del(`/projects/${p.id}`)
    setProjects((ps) => ps.filter((x) => x.id !== p.id))
    setToast({
      text: `《${p.title}》已删除`,
      actionText: '撤销',
      onAction: async () => {
        await api.post(`/projects/${p.id}/restore`)
        bump()
      },
    })
  }

  return (
    <div className="layout">
      {/* ---------- 全宽顶栏：品牌 + 作品 + 页签 + 数据条 ---------- */}
      <header className="topbar">
        <div className="brand">
          <span className="seal-logo">墨</span>
          <b>墨案</b>
          <span className="sub">AI 创作工作台</span>
        </div>
        {active && <span className="top-proj">{active.title}</span>}
        {active && (
          <nav className="tabs">
            {TABS.map((t) => (
              <button key={t.id} className={`tab${tab === t.id ? ' on' : ''}`}
                onClick={() => setTab(t.id)}>
                {t.label}
                {t.id === 'outline' && stats && stats.fspDangling > 0 &&
                  <span className="badge">{stats.fspDangling}</span>}
              </button>
            ))}
          </nav>
        )}
        {stats && (
          <span className="statstrip">
            <span>总字数 <b>{stats.words.toLocaleString()}</b></span><i className="sep">|</i>
            <span>章节 <b>{stats.written}/{stats.plan}</b></span><i className="sep">|</i>
            <span>伏笔回收 <b>{stats.fspDone}/{stats.fsp}</b></span><i className="sep">|</i>
            <span>人物 <b>{stats.chars}</b></span>
          </span>
        )}
      </header>

      <div className="cols">
        {/* ---------- 书架栏 ---------- */}
        <aside className="col-shelf">
          <div className="shelf-head">
            <span className="sh-title">书 架</span>
            <button className="icon-btn" title="新建作品" onClick={() => setShowNew(true)}>✚</button>
          </div>
          <div className="shelf-list">
            {projects.map((p, i) => (
              <button key={p.id} className={`book${p.id === activeId ? ' on' : ''}`}
                onClick={() => setActiveId(p.id)} onContextMenu={(e) => { e.preventDefault(); deleteProject(p) }}>
                <span className="spine" style={{ background: SPINE_COLORS[i % SPINE_COLORS.length] }}>
                  {p.title[0] || '书'}
                </span>
                <span className="meta">
                  <span className="t">{p.title}</span>
                  <span className="s">{p.genre} · {p.phase}</span>
                </span>
              </button>
            ))}
            {projects.length === 0 && (
              <Empty text="书架尚空" actionText="开一本书" onAction={() => setShowNew(true)} />
            )}
          </div>
          <div className="shelf-foot">右键书脊可删除<span className="kai">5 秒内可撤销</span></div>
        </aside>

        {/* ---------- 主区 ---------- */}
        <main className="page">
          {!active ? (
            <Empty text="先在左侧开一本书" actionText="新建作品" onAction={() => setShowNew(true)} />
          ) : tab === 'text' ? (
            <TextPage project={active} onChanged={bump} toast={setToast} />
          ) : tab === 'chars' ? (
            <CharsPage project={active} onChanged={bump} />
          ) : tab === 'outline' ? (
            <OutlinePage project={active} onChanged={bump} />
          ) : tab === 'world' ? (
            <WorldPage project={active} onChanged={bump} />
          ) : tab === 'board' ? (
            <BoardPage project={active} stats={stats} />
          ) : tab === 'chat' ? (
            <ChatPage project={active} />
          ) : tab === 'generate' ? (
            <GeneratePage project={active} onChanged={bump} />
          ) : tab === 'skills' ? (
            <SkillsPage project={active} onChanged={bump} />
          ) : (
            <PrefsPage project={active} onChanged={bump} />
          )}
        </main>
      </div>
      {showNew && (
        <NewProjectModal onClose={() => setShowNew(false)} onCreated={(id) => {
          setShowNew(false)
          bump()
          setActiveId(id)
        }} />
      )}
      {toast && <Toast msg={toast} onDone={() => setToast(null)} />}
    </div>
  )
}

function NewProjectModal({ onClose, onCreated }: {
  onClose: () => void; onCreated: (id: number) => void
}) {
  const [title, setTitle] = useState('')
  const [genre, setGenre] = useState(GENRES[0])
  const [synopsis, setSynopsis] = useState('')
  const [pov, setPov] = useState(POVS[1])
  const [tones, setTones] = useState<string[]>([])
  const [target, setTarget] = useState(200000)

  async function submit() {
    if (!title.trim()) return
    const p = await api.post<Project>('/projects', {
      title: title.trim(), genre, synopsis: synopsis || null,
      pov, tones, target_words: target || null,
    })
    onCreated(p.id)
  }

  return (
    <Modal title="开一本新书" onClose={onClose}>
      <label className="field"><span>书名</span>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如：无锋" />
      </label>
      <label className="field"><span>题材</span>
        <select className="select" value={genre} onChange={(e) => setGenre(e.target.value)}>
          {GENRES.map((g) => <option key={g}>{g}</option>)}
        </select>
      </label>
      <label className="field"><span>一句话简介</span>
        <textarea className="input" rows={2} value={synopsis} onChange={(e) => setSynopsis(e.target.value)} />
      </label>
      <div style={{ display: 'flex', gap: 10 }}>
        <label className="field" style={{ flex: 1 }}><span>叙事人称</span>
          <select className="select" value={pov} onChange={(e) => setPov(e.target.value)}>
            {POVS.map((g) => <option key={g}>{g}</option>)}
          </select>
        </label>
        <label className="field" style={{ flex: 1 }}><span>目标字数</span>
          <input className="input" type="number" value={target}
            onChange={(e) => setTarget(+e.target.value)} />
        </label>
      </div>
      <label className="field"><span>基调（可多选）</span>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {TONES.map((t) => (
            <button key={t} className={`pill${tones.includes(t) ? ' seal' : ''}`}
              onClick={() => setTones((cur) => cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t])}>
              {t}
            </button>
          ))}
        </div>
      </label>
      <div className="actions">
        <button className="btn" onClick={onClose}>取消</button>
        <button className="btn primary" disabled={!title.trim()} onClick={submit}>开书</button>
      </div>
    </Modal>
  )
}
