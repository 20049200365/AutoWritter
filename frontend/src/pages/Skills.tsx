/* Skill 管理（M7 §9.2 页面 9）：列表 / 启停 / 注入点展示 */
import { useEffect, useState } from 'react'
import { api, Project, Skill } from '../api'

const POINT_LABELS: Record<string, string> = {
  world: '世界观', outline: '大纲', draft: '正文', review: '评审',
}

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
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      <h2 className="h2">Skill 技能包</h2>
      <p className="hint kai" style={{ marginBottom: 12 }}>
        Skill 是题材写作惯例包，注入到生成与评审提示词。正文存于文件（{`~/.novelstudio/skills/`}），可直接编辑后在此页查看启停。
      </p>
      <div className="row-list">
        {skills.map((s) => (
          <div key={s.id} className="row-item">
            <span className={`pill ${s.enabled ? 'leaf' : ''}`}>{s.enabled ? '启用' : '停用'}</span>
            <span className="grow">
              <span className="t">{s.name}{s.scope === 'project' && <span className="hint">（本项目）</span>}</span>
              <span className="s" style={{ display: 'block' }}>
                {s.genre ? `${s.genre} · ` : ''}注入：{s.inject_points.map((p) => POINT_LABELS[p] || p).join('、')} · v{s.version}
              </span>
            </span>
            <button className="btn sm" onClick={() => toggle(s)}>{s.enabled ? '停用' : '启用'}</button>
          </div>
        ))}
      </div>
      <p className="hint" style={{ marginTop: 10 }}>
        新增自定义 Skill：在 skills 目录建「目录名/skill.md」（frontmatter: name / inject_points），重启后自动加载。
      </p>
    </div>
  )
}
