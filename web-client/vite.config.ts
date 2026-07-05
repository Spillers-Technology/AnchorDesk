import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'fs'

// Bake the package version into the bundle so the UI can show which build is
// running (answers "did the deploy land?" at a glance — see AccountMenu).
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'))

// Backend origin the dev proxy forwards to. Host-local dev is the common path
// for `npm run dev`, so default to localhost. Containerized dev can override
// this with BACKEND_ORIGIN=http://backend:8060.
const backendOrigin = process.env.BACKEND_ORIGIN || 'http://localhost:8060'
const backendWs = backendOrigin.replace(/^http/, 'ws')

// https://vitejs.dev/config/
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  server: {
    host: true,   // bind 0.0.0.0 — required for Docker / k8s
    port: 5173,
    proxy: {
      '/api': {
        target: backendOrigin,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      // Probe self-service + MCP keep their paths (backend serves them at root).
      '/probe': { target: backendOrigin, changeOrigin: true },
      '/mcp': { target: backendOrigin, changeOrigin: true },
      // MCP OAuth: discovery metadata + the authorization-server endpoints. These
      // live at the origin root (the issuer is the app's base URL), so the backend
      // serves them un-prefixed too.
      '/.well-known': { target: backendOrigin, changeOrigin: true },
      '/oauth': { target: backendOrigin, changeOrigin: true },
      // WebSocket live-update channel — the /api prefix is stripped to /ws.
      '/api/ws': {
        target: backendWs,
        ws: true,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    }
  },
  plugins: [react()],
})
