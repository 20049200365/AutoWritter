/* 跨页轻量事件总线：正文空章态「让 Agent 起草」→ 对话页输入框
   emit 的值会滞留到首个订阅者消费（跨 tab 切换也不丢） */
const pending: Record<string, unknown> = {}

export function emit(name: string, detail?: unknown) {
  pending[name] = detail
  window.dispatchEvent(new CustomEvent(name, { detail }))
}

export function on(name: string, fn: (detail: any) => void): () => void {
  if (pending[name] !== undefined) {
    const d = pending[name]
    delete pending[name]
    setTimeout(() => fn(d), 0)
  }
  const h = (e: Event) => fn((e as CustomEvent).detail)
  window.addEventListener(name, h)
  return () => window.removeEventListener(name, h)
}
