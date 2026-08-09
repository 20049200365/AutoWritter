/* Agent 对话：会话管理 + SSE 流式 + 工具卡片（标记对齐参考模板） */
import { useEffect, useRef, useState } from 'react'
import { api, Project, sseStream } from '../api'
import { Empty } from '../ui'

interface Session { id: number; title: string; created_at: string }
interface Msg {
  id?: number; role: 'user' | 'assistant'; content: string
  tools?: Array<{ name: string; result?: string; done: boolean }>
  streaming?: boolean
}

export default function ChatPage({ project }: { project: Project }) {
  const [sessions, setSessions] = useState<Session[]>([])
  const [sid, setSid] = useState<number | null>(null)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    api.get<Session[]>(`/projects/${project.id}/sessions`).then((ss) => {
      setSessions(ss)
      setSid((cur) => cur ?? ss[0]?.id ?? null)
    })
  }, [project.id])

  useEffect(() => {
    if (sid == null) { setMsgs([]); return }
    api.get<any[]>(`/sessions/${sid}/messages`).then((ms) =>
      setMsgs(ms.map((m) => ({ role: m.role, content: m.content || '' }))))
  }, [sid])

  useEffect(() => {
    boxRef.current?.scrollTo({ top: boxRef.current.scrollHeight })
  }, [msgs])

  async function newSession() {
    const s = await api.post<Session>('/sessions', { project_id: project.id, title: '新会话' })
    setSessions((cur) => [...cur, s])
    setSid(s.id)
  }

  async function send() {
    const text = input.trim()
    if (!text || busy) return
    if (sid == null) { await newSession() }
    const target = sid ?? sessions[sessions.length - 1]?.id
    if (target == null) return
    setInput('')
    setBusy(true)
    setMsgs((cur) => [...cur, { role: 'user', content: text },
      { role: 'assistant', content: '', tools: [], streaming: true }])
    try {
      for await (const ev of sseStream(`/sessions/${target}/chat`, { text })) {
        const d = ev.data || {}
        setMsgs((cur) => {
          const next = [...cur]
          const ai = next[next.length - 1]
          if (ev.event === 'tool_call') {
            ai.tools = [...(ai.tools || []), { name: d.name, done: false }]
          } else if (ev.event === 'tool_result') {
            ai.tools = (ai.tools || []).map((t) =>
              t.name === d.name && !t.done ? { ...t, result: d.result, done: true } : t)
          } else if (ev.event === 'token') {
            ai.content += d.delta
          } else if (ev.event === 'done') {
            ai.streaming = false
          }
          return [...next.slice(0, -1), { ...ai }]
        })
      }
    } catch (e: any) {
      setMsgs((cur) => {
        const next = [...cur]
        const ai = next[next.length - 1]
        return [...next.slice(0, -1), { ...ai, content: ai.content + `\n（出错：${e.message}）`, streaming: false }]
      })
    }
    setBusy(false)
  }

  return (
    <div className="chat-wrap">
      <div className="chat-scroll" ref={boxRef}>
        <div className="chat-inner">
          {msgs.length === 0 && (
            <Empty text={sessions.length === 0 ? '和助手聊聊你的故事' : '这个会话还是空的'}
              actionText="新开一个会话" onAction={newSession} />
          )}
          {msgs.map((m, i) => (
            <div key={i} className={`msg ${m.role === 'user' ? 'user' : 'ai'}`}>
              <span className="avatar">{m.role === 'user' ? '我' : '墨'}</span>
              <div className="bubble">
                <div className="who">{m.role === 'user' ? '作者' : '墨案 · Agent'}</div>
                {(m.tools || []).map((t, j) => (
                  <div key={j} className="toolcard">
                    <div className="tc-hd">
                      <span className="tc-name">{t.name}</span>
                      <span className="r-main" />
                      <span className={`tc-state ${t.done ? 'done' : 'run'}`}>
                        {t.done ? '✓ 完成' : <><span className="spinner" /> 调用中</>}
                      </span>
                    </div>
                    {t.result && <div className="tc-result">{t.result}</div>}
                  </div>
                ))}
                <div className="body">
                  {m.content}
                  {m.streaming && <span className="cursor" />}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="chat-input">
        <div className="ci-box">
          <textarea rows={2} value={input} placeholder="描述你的想法…（Enter 发送，Shift+Enter 换行）"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
            }} />
          <button className="btn primary sm" disabled={busy || !input.trim()} onClick={send}>落笔</button>
        </div>
        <div className="ci-meta">
          <select className="select" style={{ width: 200, padding: '3px 8px', fontSize: 12 }} value={sid ?? ''}
            onChange={(e) => setSid(+e.target.value)}>
            <option value="">选择会话…</option>
            {sessions.map((s) => <option key={s.id} value={s.id}>{s.title || `会话 ${s.id}`}</option>)}
          </select>
          <button className="btn ghost sm" onClick={newSession}>＋ 新会话</button>
          {sid != null && (
            <button className="btn ghost sm danger" onClick={async () => {
              await api.del(`/sessions/${sid}`)
              setSessions((cur) => cur.filter((s) => s.id !== sid))
              setSid(null)
            }}>删除会话</button>
          )}
          <span className="grow" />
          <span>AI 会检索本书设定与章节后作答</span>
        </div>
      </div>
    </div>
  )
}
