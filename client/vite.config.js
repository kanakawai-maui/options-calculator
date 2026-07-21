import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Static routes served directly from public/ in dev — bypasses the SPA fallback
const STATIC_ROUTES = {
  '/home':  'public/home/index.html',
  '/about': 'public/about/index.html',
  '/legal': 'public/legal/index.html',
}

const staticPagesPlugin = {
  name: 'static-pages',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const path = req.url?.split('?')[0].replace(/\/$/, '') || ''
      const file = STATIC_ROUTES[path]
      if (file) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.end(readFileSync(resolve(__dirname, file)))
        return
      }
      next()
    })
  },
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), staticPagesPlugin],
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    hmr: {
      host: 'localhost',
      port: 5173,
    },
    watch: {
      usePolling: true,
      interval: 120,
    },
  },
})
