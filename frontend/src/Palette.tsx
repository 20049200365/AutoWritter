/* ⌘K 命令面板（对齐参考模板 §六）：跨作品/章节/人物/设定/伏笔/会话统一检索 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { api, Chapter, Character, fmtCh, Foreshadow, Project, Session, WorldEntry } from './api'

export interface PalNav {
  project: (id: number) => void
  tab: (tab: string) => void
  openChapter: (id: number) => void
  openSession: (id: number) => void
}

interface Entry { type: string; label: string; sub: string; go: () => void }

const TYPE_CLS: Record<string, string> = {
  作品: 'seal', 章节: 'qing', 人物: 'zhe', 设定: 'zi', 伏笔: 'lv', 会话: 'tie',
}

export default function Palette({ projects, nav, onClose }: {
  projects: Project[]; nav: PalNav; onClose: () => void
}) {
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const [entries, setEntries] = useState<Entry[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  useEffect(() => {
    // 打开时跨作品拉全量实体（面板低频，一次性装载）
    (async () => {
      const out: Entry[] = []
      for (const p of projects) {
        out.push({ type: '作品', label: p.title, sub: `${p.genre} · ${p.phase}`, go: () => { nav.project(p.id); nav.tab('shelf') } })
        const [cs, chars, es, fs, ss] = await Promise.all([
          api.get<Chapter[]>(`/projects/${p.id}/chapters`).catch(() => [] as Chapter[]),
          api.get<Character[]>(`/characters?project_id=${p.id}`).catch(() => [] as Character[]),
          api.get<WorldEntry[]>(`/world-entries?project_id=${p.id}`).catch(() => [] as WorldEntry[]),
          api.get<Foreshadow[]>(`/foreshadows?project_id=${p.id}`).catch(() => [] as Foreshadow[]),
          api.get<Session[]>(`/projects/${p.id}/sessions`).catch(() => [] as Session[]),
        ])
        cs.forEach((c) => out.push({
          type: '章节', label: `${fmtCh(c.seq)} ${c.title}`, sub: p.title,
          go: () => { nav.project(p.id); nav.openChapter(c.id) },
        }))
        chars.forEach((c) => out.push({
          type: '人物', label: c.name, sub: `${p.title} · ${c.role || '未定位'}`,
          go: () => { nav.project(p.id); nav.tab('chars') },
        }))
        es.forEach((e) => out.push({
          type: '设定', label: e.name, sub: `${p.title} · ${e.category}`,
          go: () => { nav.project(p.id); nav.tab('world') },
        }))
        fs.forEach((f) => out.push({
          type: '伏笔', label: f.title, sub: `${p.title} · ${f.state}`,
          go: () => { nav.project(p.id); nav.tab('outline') },
        }))
        ss.forEach((s) => out.push({
          type: '会话', label: s.title || `会话 ${s.id}`, sub: p.title,
          go: () => { nav.project(p.id); nav.openSession(s.id) },
        }))
      }
      setEntries(out)
    })()
  }, [projects])   // eslint-disable-line react-hooks/exhaustive-deps

  const list = useMemo(() => {
    const kw = q.trim().toLowerCase()
    const hit = kw ? entries.filter((e) => (e.label + ' ' + e.sub + ' ' + e.type).toLowerCase().includes(kw)) : entries
    return hit.slice(0, 40)
  }, [entries, q])

  useEffect(() => { if (sel >= list.length) setSel(0) }, [list.length, sel])

  function go(item: Entry | undefined) {
    if (!item) return
    item.go()
    onClose()
  }

  return (
    <div className="pal-mask" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="palette">
        <input ref={inputRef} value={q} placeholder="跨作品检索：章节 / 人物 / 设定 / 伏笔 / 会话…（方向键选择，回车跳转）"
          onChange={(e) => { setQ(e.target.value); setSel(0) }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(list.length - 1, s + 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)) }
            else if (e.key === 'Enter') { e.preventDefault(); go(list[sel]) }
            else if (e.key === 'Escape') onClose()
          }} />
        <div className="pal-list">
          {list.length === 0 && <div className="dim" style={{ padding: 14, textAlign: 'center', fontSize: 12 }}>没有匹配项——换个关键词试试。</div>}
          {list.map((e, i) => (
            <div key={i} className={`pal-item${i === sel ? ' sel' : ''}`} onMouseEnter={() => setSel(i)} onClick={() => go(e)}>
              <span className={`tag ${TYPE_CLS[e.type] || ''}`}>{e.type}</span>
              <span className="pi-t">{e.label}</span>
              <span className="pi-s">{e.sub}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
