import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The web app runs on its own port (5173) and calls the API server on its own
// port directly — set VITE_API_URL in client/.env (default http://localhost:5000).
// No dev proxy: the browser talks to the API exactly as it will in production.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { chunkSizeWarningLimit: 700 },
  server: { port: 5173 },
})
