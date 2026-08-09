import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 后端路由前缀（M6 §2 全量），dev 时代理到 127.0.0.1:8000
const BACKEND_PREFIXES = [
  '/projects', '/outline', '/chapters', '/characters', '/relations',
  '/foreshadows', '/world-entries', '/timeline-events', '/skills',
  '/sessions', '/suggestions', '/preferences', '/tasks', '/health', '/config',
]

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: Object.fromEntries(
      BACKEND_PREFIXES.map((p) => [p, { target: 'http://127.0.0.1:8000', changeOrigin: true }]),
    ),
  },
  build: { outDir: 'dist' },
})
