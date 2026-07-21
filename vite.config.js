import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Same React + Vite setup as the main website. During local dev, /api requests
// are proxied to the local Express server (local-server.js on port 3001) so the
// serverless functions in /api can be developed and tested locally. On Vercel,
// /api is served by the platform automatically, so the proxy is dev-only.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
})
