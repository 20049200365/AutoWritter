/* 共享小组件：弹层 / Toast / 空态（标记结构对齐参考模板） */
import { ReactNode, useEffect, useState } from 'react'

export function Modal({ title, children, onClose }: {
  title: string; children: ReactNode; onClose: () => void
}) {
  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [onClose])
  return (
    <div className="mask" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal">
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  )
}

export interface ToastMsg { text: string; actionText?: string; onAction?: () => void }

export function Toast({ msg, onDone }: { msg: ToastMsg; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 5000)
    return () => clearTimeout(t)
  }, [msg, onDone])
  return (
    <div className="toast">
      <span>{msg.text}</span>
      {msg.actionText && (
        <button onClick={() => { msg.onAction?.(); onDone() }}>{msg.actionText}</button>
      )}
    </div>
  )
}

/* 空态：sub 为二级引导，双按钮给双路径 */
export function Empty({ text, sub, actionText, onAction, action2Text, onAction2 }: {
  text: string; sub?: string
  actionText?: string; onAction?: () => void
  action2Text?: string; onAction2?: () => void
}) {
  return (
    <div className="empty">
      <p className="kai">{text}</p>
      {sub && <p style={{ fontSize: 12, maxWidth: 360 }}>{sub}</p>}
      {(actionText || action2Text) && (
        <div style={{ display: 'flex', gap: 10 }}>
          {action2Text && <button className="btn" onClick={onAction2}>{action2Text}</button>}
          {actionText && <button className="btn primary" onClick={onAction}>{actionText}</button>}
        </div>
      )}
    </div>
  )
}

export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]): T | null {
  const [data, setData] = useState<T | null>(null)
  useEffect(() => {
    let alive = true
    fn().then((d) => { if (alive) setData(d) }).catch(() => { /* 顶部已有错误提示 */ })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return data
}
