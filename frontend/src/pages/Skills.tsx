/* Skill 技能包（标记对齐参考模板）：题材写作惯例包，正文存于文件，可编辑后在此启停 */
import { useEffect, useState } from 'react'
import { api, Project, Skill } from '../api'
import { Empty } from '../ui'

export default function SkillsPage({ project, onChanged }: {
  project: Project; onChanged: () => void
}) {
  const [skills, setSkills] = useState<Skill[]>([])

  const load = () => api.get<Skill[]>('/skills').then(setSkills)
  useEffect(() => { load() }, [project.id])

  async function toggle(s: Skill) {
    await api.post(`/skills/${s.id}/enable`, { enabled: !s.enabled })
    await load(); onChanged()
  }

  return (
    <div className="out-wrap"><div className="out-inner" style={{ maxWidth: 820 }}>
      <div className="card vol-card">
        <div className="vol-hd">
          <span className="v-name">Skill 技能包</span>
          <span className="v-sum">注入生成与评审提示词 · 正文存于 ~/.novelstudio/skills/，可直接编辑</span>
        </div>
        {skills.length === 0 ? (
          <Empty glyph="技" text="还没有技能包" />
        ) : skills.map((s) => (
          <div key={s.id} className="ch-row">
            <span className="ch-title">{s.name}</span>
            <span className="ch-beat">
              {s.genre ? `${s.genre} · ` : ''}{s.scope === 'global' ? '全局' : '本书'} · 注入点 {s.inject_points.join('/')}
            </span>
            <span className={`tag ${s.enabled ? 'lv' : ''}`}>{s.enabled ? '启用' : '停用'}</span>
            <button className="btn sm" onClick={() => toggle(s)}>{s.enabled ? '停用' : '启用'}</button>
          </div>
        ))}
      </div>
      <div className="notice">
        Skill 是题材写作惯例包：写手与评审都会读。改文件即生效，版本自增。
      </div>
    </div></div>
  )
}
