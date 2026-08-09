/* 共享小组件：弹层 / Toast / 空态 */
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
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
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

export function Empty({ text, actionText, onAction }: {
  text: string; actionText?: string; onAction?: () => void
}) {
  return (
    <div className="empty">
      <span className="kai">{text}</span>
      {actionText && <button className="btn primary" onClick={onAction}>{actionText}</button>}
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
