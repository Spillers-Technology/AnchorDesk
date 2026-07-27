import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'node:url'

// Bake the package version into the bundle so the UI can show which build is
// running (answers "did the deploy land?" at a glance — see AccountMenu).
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'))

// Backend origin the dev proxy forwards to. Host-local dev is the common path
// for `npm run dev`, so default to localhost. Containerized dev can override
// this with BACKEND_ORIGIN=http://backend:8060.
const backendOrigin = process.env.BACKEND_ORIGIN || 'http://localhost:8060'
const backendWs = backendOrigin.replace(/^http/, 'ws')

function isPortalDocumentRequest(request: {
  method?: string;
  url?: string;
  headers: { accept?: string | string[] };
}): boolean {
  if (request.method !== 'GET' || !request.url) return false
  const accept = request.headers.accept
  if (typeof accept !== 'string' || !accept.includes('text/html')) return false
  const pathname = new URL(request.url, 'http://vite.local').pathname
  return (
    (pathname === '/portal' || pathname.startsWith('/portal/'))
    && pathname !== '/portal/index.html'
  )
}

// Vite's normal SPA fallback always selects the root index.html. The customer
// portal is a second HTML entry, so nested portal routes need an explicit
// development/preview rewrite to keep hard reloads out of the staff bundle.
function portalHistoryFallback(): Plugin {
  return {
    name: 'anchordesk-portal-history-fallback',
    configureServer(server) {
      server.middlewares.use((request, _response, next) => {
        if (isPortalDocumentRequest(request)) request.url = '/portal/index.html'
        next()
      })
    },
    configurePreviewServer(server) {
      server.middlewares.use((request, _response, next) => {
        if (isPortalDocumentRequest(request)) request.url = '/portal/index.html'
        next()
      })
    },
  }
}

// https://vitejs.dev/config/
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  build: {
    rollupOptions: {
      input: {
        staff: fileURLToPath(new URL('./index.html', import.meta.url)),
        portal: fileURLToPath(new URL('./portal/index.html', import.meta.url)),
      },
    },
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
  plugins: [portalHistoryFallback(), react()],
})
