import { useCallback, useEffect, useState } from 'react'
import { api, GENRES, TONES, Project, Stats } from './api'
import { Empty, Modal, Toast, ToastMsg } from './ui'
import Palette from './Palette'
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
  { id: 'shelf', label: '书架' },
  { id: 'text', label: '正文' },
  { id: 'chars', label: '人物关系' },
  { id: 'outline', label: '大纲与伏笔' },
  { id: 'world', label: '世界观' },
  { id: 'board', label: '时间线与看板' },
  { id: 'chat', label: 'Agent 对话' },
  { id: 'generate', label: '生成' },
  { id: 'skills', label: 'Skill' },
  { id: 'prefs', label: '偏好' },
] as const

type TabId = typeof TABS[number]['id']

export default function App() {
  const [projects, setProjects] = useState<Project[]>([])
  const [activeId, setActiveId] = useState<number | null>(null)
  const [tab, setTab] = useState<TabId>('shelf')
  const [stats, setStats] = useState<Stats | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [delTarget, setDelTarget] = useState<Project | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [toast, setToast] = useState<ToastMsg | null>(null)
  const [refresh, setRefresh] = useState(0)
  const [jump, setJump] = useState<{ ch?: number; ses?: number; n: number }>({ n: 0 })

  const bump = useCallback(() => setRefresh((r) => r + 1), [])

  useEffect(() => {
    api.get<Project[]>('/projects').then((ps) => {
      setProjects(ps)
      setActiveId((cur) => cur ?? ps[0]?.id ?? null)
    }).catch(() => setToast({ text: '后端未连接：请先双击 start.bat 启动（端口 8000）' }))
  }, [refresh])

  useEffect(() => {
    if (activeId == null) { setStats(null); return }
    api.get<Stats>(`/projects/${activeId}/stats`).then(setStats).catch(() => setStats(null))
  }, [activeId, refresh])

  /* ⌘K 命令面板 / Esc 关抽屉（对齐参考模板 §六键盘约定） */
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        setPaletteOpen((v) => !v)
      } else if (e.key === 'Escape') {
        document.body.classList.remove('ctx-open')
      }
    }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [])

  const active = projects.find((p) => p.id === activeId) || null
  const activeIdx = active ? projects.indexOf(active) : 0

  async function confirmDelete(p: Project) {
    setDelTarget(null)
    await api.del(`/projects/${p.id}`)
    setProjects((ps) => ps.filter((x) => x.id !== p.id))
    if (activeId === p.id) setActiveId(null)
    setToast({
      text: `《${p.title}》已删除`,
      actionText: '撤销',
      onAction: async () => {
        await api.post(`/projects/${p.id}/restore`)
        bump()
        setActiveId(p.id)
      },
    })
  }

  return (
    <div id="app">
      {/* ---------- 顶栏：品牌 + 作品 + 页签 + 数据条 ---------- */}
      <header id="topbar">
        <div className="brand">
          <span className="seal">墨</span>
          <b>墨案</b>
          <span className="sub">AI 创作工作台</span>
        </div>
        {active && (
          <span id="topProject">
            <span className="genre-dot" style={{ background: SPINE_COLORS[activeIdx % SPINE_COLORS.length] }} />
            {active.title}
          </span>
        )}
        <button className="icon-btn ctx-toggle" title="展开 / 收起上下文栏"
          onClick={() => document.body.classList.toggle('ctx-open')}>☰</button>
        <nav id="tabbar">
          {TABS.map((t) => (
            <button key={t.id} className={`tab${tab === t.id ? ' on' : ''}`}
              onClick={() => setTab(t.id)}>
              {t.label}
              {t.id === 'outline' && stats && stats.fspDangling > 0 &&
                <span className="badge">{stats.fspDangling}</span>}
              {t.id === 'text' && stats && stats.plan > 0 && <span className="badge">{stats.written}/{stats.plan}</span>}
              {t.id === 'chat' && stats && stats.sessions > 0 && <span className="badge">{stats.sessions}</span>}
            </button>
          ))}
        </nav>
        {stats && (
          <span id="statstrip">
            <span>总字数 <b>{stats.words.toLocaleString()}</b></span><span className="sep">|</span>
            <span>章节 <b>{stats.written}/{stats.plan}</b></span><span className="sep">|</span>
            <span>伏笔回收 <b>{stats.fspDone}/{stats.fsp}</b></span><span className="sep">|</span>
            <span>人物 <b>{stats.chars}</b></span>
          </span>
        )}
      </header>

      <div id="cols">
        {/* ---------- 书架栏 ---------- */}
        <aside id="colShelf">
          <div className="shelf-head">
            <span className="sh-title">书 架</span>
            <button className="icon-btn" title="新建作品" onClick={() => setShowNew(true)}>✚</button>
          </div>
          <div className="shelf-list">
            {projects.map((p, i) => (
              <button key={p.id} className={`shelf-item${p.id === activeId ? ' on' : ''}`}
                onClick={() => setActiveId(p.id)} onContextMenu={(e) => { e.preventDefault(); setDelTarget(p) }}>
                <span className="spine" style={{ background: SPINE_COLORS[i % SPINE_COLORS.length] }}>
                  {p.title[0] || '书'}
                </span>
                <span className="si-body">
                  <span className="si-title">{p.title}</span>
                  <span className="si-sub">{p.genre} · {p.phase}</span>
                </span>
              </button>
            ))}
            {projects.length === 0 && (
              <Empty text="书架尚空，开一本书开始创作" actionText="开一本书" onAction={() => setShowNew(true)} />
            )}
          </div>
          <div className="shelf-foot">
            右键书脊可删除<span className="kai">5 秒内可撤销 · 数据存于本机</span>
            <span className="kai">按 <kbd>Ctrl</kbd>+<kbd>K</kbd> 全局检索</span>
          </div>
        </aside>

        {/* ---------- 主区 ---------- */}
        <main id="colMain">
          {tab === 'shelf' ? (
            <ShelfMain projects={projects} stats={stats} activeId={activeId}
              onOpen={(id) => { setActiveId(id); setTab('text') }}
              onDelete={setDelTarget} onNew={() => setShowNew(true)} />
          ) : !active ? (
            <Empty text="先在左侧开一本书" actionText="新建作品" onAction={() => setShowNew(true)} />
          ) : tab === 'text' ? (
            <TextPage project={active} onChanged={bump} toast={setToast} initialChapter={jump.ch} jumpSeq={jump.n} />
          ) : tab === 'chars' ? (
            <CharsPage project={active} onChanged={bump} />
          ) : tab === 'outline' ? (
            <OutlinePage project={active} onChanged={bump} />
          ) : tab === 'world' ? (
            <WorldPage project={active} onChanged={bump} />
          ) : tab === 'board' ? (
            <BoardPage project={active} stats={stats} gotoChapter={(id) => {
              setJump((cur) => ({ ...cur, ch: id, n: cur.n + 1 }))
              setTab('text')
            }} />
          ) : tab === 'chat' ? (
            <ChatPage project={active} stats={stats} onChanged={bump} initialSession={jump.ses} jumpSeq={jump.n} />
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
          setTab('chat')
        }} />
      )}
      {delTarget && (
        <DelProjectModal project={delTarget}
          onClose={() => setDelTarget(null)} onConfirm={() => confirmDelete(delTarget)} />
      )}
      {paletteOpen && (
        <Palette projects={projects} onClose={() => setPaletteOpen(false)}
          nav={{
            project: (id) => setActiveId(id),
            tab: (t) => setTab(t as TabId),
            openChapter: (id) => { setJump((cur) => ({ ...cur, ch: id, n: cur.n + 1 })); setTab('text') },
            openSession: (id) => { setJump((cur) => ({ ...cur, ses: id, n: cur.n + 1 })); setTab('chat') },
          }} />
      )}
      {toast && <Toast msg={toast} onDone={() => setToast(null)} />}
    </div>
  )
}

/* ---------- 书架主页（主区卡片网格，对齐参考模板 renderShelfMain） ---------- */
function ShelfMain({ projects, stats, activeId, onOpen, onDelete, onNew }: {
  projects: Project[]; stats: Stats | null; activeId: number | null
  onOpen: (id: number) => void; onDelete: (p: Project) => void; onNew: () => void
}) {
  if (projects.length === 0) {
    return (
      <Empty text="书架空了。每一部长篇都是从一行简介开始的。"
        actionText="新建第一部作品" onAction={onNew} />
    )
  }
  return (
    <div className="shelf-grid" style={{ overflowY: 'auto', flex: 1 }}>
      {projects.map((p, i) => {
        const isCur = p.id === activeId
        const target = p.target_words || 200000
        const words = isCur ? (stats?.words ?? 0) : 0
        const pct = isCur ? Math.min(100, Math.round((words / target) * 100)) : 0
        return (
          <div key={p.id} className="card book-card fade-in">
            <div className="bc-top">
              <span className="spine" style={{ background: SPINE_COLORS[i % SPINE_COLORS.length] }}>{p.title[0] || '书'}</span>
              <div style={{ minWidth: 0 }}>
                <h4>{p.title}</h4>
                <div className="dim" style={{ fontSize: 12 }}>{p.genre} · {p.pov || '—'} · {(p.tones || []).join(' / ') || '未定基调'}</div>
              </div>
            </div>
            <div className="bc-brief">{p.synopsis || '暂无简介'}</div>
            <div className="bc-meta">
              <span className="tag">{p.phase}</span>
              {isCur && stats && <>
                <span className="tag">{stats.written}/{stats.plan} 章</span>
                <span className="tag">{stats.words.toLocaleString()} 字</span>
                <span className="tag">{stats.chars} 人物</span>
                <span className="tag">{stats.fsp} 伏笔</span>
              </>}
            </div>
            {isCur && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div className="progress"><i style={{ width: `${pct}%` }} /></div>
                <span className="mono dim" style={{ fontSize: 11 }}>{pct}%</span>
              </div>
            )}
            <div className="bc-acts">
              <button className="btn danger sm" onClick={() => onDelete(p)}>删除</button>
              <button className="btn primary sm" onClick={() => onOpen(p.id)}>{isCur ? '继续写' : '进入'}</button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

/* ---------- 删除确认（说清代价，对齐参考模板 modalDelProject） ---------- */
function DelProjectModal({ project, onClose, onConfirm }: {
  project: Project; onClose: () => void; onConfirm: () => void
}) {
  const [st, setSt] = useState<Stats | null>(null)
  useEffect(() => {
    api.get<Stats>(`/projects/${project.id}/stats`).then(setSt).catch(() => setSt(null))
  }, [project.id])
  return (
    <Modal title={`删除《${project.title}》？`} onClose={onClose}>
      <div className="notice" style={{ marginBottom: 14 }}>
        {st
          ? <>这部作品共 <b>{st.plan} 章大纲</b>、<b>{st.written} 章正文（{st.words.toLocaleString()} 字）</b>、<b>{st.sessions} 个会话</b>、{st.chars} 位人物、{st.fsp} 条伏笔。</>
          : '正在清点这部作品的数据…'}
      </div>
      <p className="m-sub">删除后会从书架移除。我们不说「不可撤销」——Toast 里的撤销按钮有 5 秒寿命。</p>
      <div className="m-acts">
        <button className="btn" onClick={onClose}>再想想</button>
        <button className="btn danger" onClick={onConfirm}>删除（5 秒内可撤销）</button>
      </div>
    </Modal>
  )
}

function NewProjectModal({ onClose, onCreated }: {
  onClose: () => void; onCreated: (id: number) => void
}) {
  const [title, setTitle] = useState('')
  const [genre, setGenre] = useState(GENRES[0])
  const [synopsis, setSynopsis] = useState('')
  const [tones, setTones] = useState<string[]>([])

  async function submit() {
    if (!title.trim()) return
    const p = await api.post<Project>('/projects', {
      title: title.trim(), genre, synopsis: synopsis || null,
      tones: tones.length ? tones : null,
    })
    onCreated(p.id)
  }

  return (
    <Modal title="开一本新书" onClose={onClose}>
      <p className="m-sub">创建后直接进入对话页，和助手聊聊这本书。</p>
      <div className="f-row"><label>书名</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如：无锋" />
      </div>
      <div className="f-row"><label>题材</label>
        <select value={genre} onChange={(e) => setGenre(e.target.value)}>
          {GENRES.map((g) => <option key={g}>{g}</option>)}
        </select>
      </div>
      <div className="f-row"><label>一句话简介<span className="hint">（可不填）</span></label>
        <textarea rows={2} value={synopsis} onChange={(e) => setSynopsis(e.target.value)} />
      </div>
      <div className="f-row"><label>基调（可多选）</label>
        <div className="tone-pick">
          {TONES.map((t) => (
            <button key={t} className={tones.includes(t) ? 'on' : ''}
              onClick={() => setTones((cur) => cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t])}>
              {t}
            </button>
          ))}
        </div>
      </div>
      <div className="m-acts">
        <button className="btn" onClick={onClose}>取消</button>
        <button className="btn primary" disabled={!title.trim()} onClick={submit}>开书</button>
      </div>
    </Modal>
  )
}
