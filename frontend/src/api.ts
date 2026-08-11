/* API 层：fetch 封装 + SSE 消费（对齐 M6 OpenAPI / M3 §5 事件契约） */

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message)
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!res.ok) {
    let body: any = {}
    try { body = await res.json() } catch { /* ignore */ }
    throw new ApiError(res.status, body.code || 'unknown', body.message || res.statusText)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body ?? {}) }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
}

/* ---------- SSE：POST/GET → 事件流（M3 §5.1 契约的 11 种事件） ---------- */
export interface SseEvent { event: string; data: any }

export async function* sseStream(path: string, body?: unknown, signal?: AbortSignal): AsyncGenerator<SseEvent> {
  const res = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body ?? {}),
    signal,
  })
  if (!res.ok || !res.body) {
    let msg = res.statusText
    try { msg = (await res.json()).message } catch { /* ignore */ }
    throw new ApiError(res.status, 'sse_failed', msg)
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buf = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      let idx: number
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, idx)
        buf = buf.slice(idx + 2)
        const ev: Partial<SseEvent> = {}
        for (const line of block.split('\n')) {
          if (line.startsWith('event: ')) ev.event = line.slice(7)
          else if (line.startsWith('data: ')) {
            try { ev.data = JSON.parse(line.slice(6)) } catch { ev.data = line.slice(6) }
          }
        }
        if (ev.event) yield ev as SseEvent
      }
    }
  } finally {
    /* 调用方 break 提前退出时也释放连接，避免悬挂占用连接池（decide 等后续请求 pending） */
    reader.cancel().catch(() => {})
  }
}

/* ---------- 类型（与后端 DTO 对齐） ---------- */
export interface Project {
  id: number; title: string; genre: string; synopsis?: string
  target_words?: number; pov?: string; tones: string[]
  phase: '筹备' | '写作'; created_at: string
}
export interface Stats {
  plan: number; written: number; words: number; chars: number; rels: number
  fsp: number; fspDone: number; fspDangling: number; entries: number
  events: number; sessions: number; gap: number
}
export interface OutlineNode {
  id: number; project_id: number; parent_id: number | null
  level: number; sort: number; title: string; summary?: string
  status: string; tension?: number
}
export interface Chapter {
  id: number; project_id: number; outline_node_id: number | null
  seq: number; title: string; text: string; word_count: number
  status: string; summary?: string; plan?: string
}
export interface Character {
  id: number; project_id: number; name: string; aliases: string[]
  gender?: string; role?: string; appearance?: string
  surface_goal?: string; deep_need?: string; secret?: string; arc?: string
}
export interface Relation {
  id: number; project_id: number; src_kind: string; src_id: number
  dst_kind: string; dst_id: number; type: string; label?: string; status: string
}
export interface Foreshadow {
  id: number; project_id: number; title: string; description?: string
  importance: number; planted_chapter_id?: number
  planned_resolve_chapter_id?: number; actual_resolve_chapter_id?: number
  state: string
}
export interface WorldEntry {
  id: number; project_id: number; category: string; name: string
  content?: string; tags: string[]
}
export interface TimelineEvent {
  id: number; project_id: number; chapter_id?: number; track: string
  time_label?: string; title: string; description?: string; sort: number
}
export interface Skill {
  id: number; scope: string; project_id?: number; name: string; genre?: string
  inject_points: string[]; enabled: boolean; filepath: string; version: number
}
export interface Session { id: number; project_id: number; title: string; created_at: string; updated_at?: string }
export interface ChatMessageDTO { id: number; session_id: number; role: string; content?: string; seq: number }
export interface Suggestion { id: number; suggestion: any; status: string }

/* ---------- 简易 markdown 渲染（对话气泡，对齐参考模板 md()） ---------- */
export function mdToHtml(src: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const inline = (s: string) => esc(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
  const out: string[] = []
  let para: string[] = [], list: string[] = [], quote: string[] = []
  const flushP = () => { if (para.length) { out.push('<p>' + inline(para.join(' ')) + '</p>'); para = [] } }
  const flushL = () => { if (list.length) { out.push('<ul>' + list.map((li) => '<li>' + inline(li) + '</li>').join('') + '</ul>'); list = [] } }
  const flushQ = () => { if (quote.length) { out.push('<blockquote>' + inline(quote.join(' ')) + '</blockquote>'); quote = [] } }
  for (const raw of (src || '').split('\n')) {
    const line = raw.trimEnd()
    if (/^###\s/.test(line)) { flushP(); flushL(); flushQ(); out.push('<h4>' + inline(line.replace(/^###\s*/, '')) + '</h4>') }
    else if (/^#{1,2}\s/.test(line)) { flushP(); flushL(); flushQ(); out.push('<h3>' + inline(line.replace(/^#{1,2}\s*/, '')) + '</h3>') }
    else if (/^[-*]\s/.test(line)) { flushP(); flushQ(); list.push(line.replace(/^[-*]\s*/, '')) }
    else if (/^>\s?/.test(line)) { flushP(); flushL(); quote.push(line.replace(/^>\s?/, '')) }
    else if (!line.trim()) { flushP(); flushL(); flushQ() }
    else { flushL(); flushQ(); para.push(line.trim()) }
  }
  flushP(); flushL(); flushQ()
  return out.join('')
}

export function stripMd(s: string): string {
  return (s || '').replace(/#{1,6}\s*/g, '').replace(/[*`>]/g, '').replace(/\s+/g, ' ').trim()
}

/* 章号等宽零填充（E9：不得折行） */
export const fmtCh = (seq: number) => `CH.${String(seq).padStart(2, '0')}`

export const GENRES = ['玄幻', '悬疑', '科幻', '情感', '日常', '历史']
export const POVS = ['第一人称', '第三人称', '全知视角']
export const TONES = ['沉郁', '治愈', '热血', '古意', '孤独', '浪漫', '轻快', '克制']
export const WORLD_CATS = ['地理', '势力', '力量体系', '器物', '名词', '习俗', '档案']
export const CH_STATUS = ['构思', '大纲', '草稿', '待修', '定稿']
export const FSP_STATES: Record<string, string> = {
  已埋设: 'cyan', 部分揭示: 'ochre', 已回收: 'leaf', 悬空: 'seal',
}
