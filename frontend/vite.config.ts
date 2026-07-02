import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The git SHA is injected at build time. CI sets VITE_GIT_SHA to github.sha;
// Vercel sets VERCEL_GIT_COMMIT_SHA. Local builds fall back to "dev".
const gitSha = process.env.VITE_GIT_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA ?? 'dev'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_SHA__: JSON.stringify(gitSha),
  },
})
