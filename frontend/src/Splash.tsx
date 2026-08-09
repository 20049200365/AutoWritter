/* 封面页（方案 A · 宣纸落印）：墨晕扩散 → 题字逐字写出 → 朱印作落款盖下 → 标语/进入按钮依次浮现 */
import { useState } from 'react'

const SLOGAN = '笔落处，世界开'

export default function Splash({ onEnter }: { onEnter: () => void }) {
  const [leaving, setLeaving] = useState(false)

  function enter() {
    if (leaving) return
    setLeaving(true)
    setTimeout(onEnter, 900)
  }

  return (
    <div id="splash" className={leaving ? 'leave' : ''}>
      <div className="sp-blot" />
      <div className="sp-stage">
        <div className="sp-title-wrap">
          <h1><span>墨</span><span>案</span></h1>
          <div className="sp-seal">墨</div>
        </div>
        <div className="sp-sub">AI 创作工作台</div>
        <button className="sp-enter" onClick={enter}>进入书架</button>
      </div>
      <div className="sp-slogan">
        {[...SLOGAN].map((c, i) => (
          <span key={i} style={{ animationDelay: `${1.9 + i * 0.12}s` }}>{c}</span>
        ))}
      </div>
    </div>
  )
}
