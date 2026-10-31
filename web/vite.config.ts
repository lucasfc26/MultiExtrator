/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

// O navegador nunca fala direto com o n8n nem com o worker: o servidor do Vite
// faz o proxy. Assim não há CORS e a chave do n8n (N8N_API_KEY, sem prefixo
// VITE_) fica só no servidor de desenvolvimento, fora do bundle.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const n8nUrl = env.N8N_URL || 'http://localhost:5678'
  const workerUrl = env.WORKER_URL || 'http://localhost:8000'
  const apiHeader = env.N8N_API_KEY_HEADER || 'X-API-Key'

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: {
      port: 5173,
      // Docker com código montado (Windows/macOS): observa arquivos por polling.
      watch: env.VITE_POLLING === 'true' ? { usePolling: true, interval: 300 } : undefined,
      proxy: {
        '/engine/n8n': {
          target: n8nUrl,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/engine\/n8n/, ''),
          // Extrações levam minutos: sem timeout no proxy.
          timeout: 0,
          proxyTimeout: 0,
          headers: env.N8N_API_KEY ? { [apiHeader]: env.N8N_API_KEY } : {},
        },
        '/engine/worker': {
          target: workerUrl,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/engine\/worker/, ''),
          timeout: 0,
          proxyTimeout: 0,
        },
        '/api': {
          target: env.BACKEND_URL || 'http://localhost:3000',
          changeOrigin: true,
        },
      },
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
      css: false,
      // Testes sempre no modo demo + simulador: nada sai da máquina.
      env: { VITE_USE_MOCKS: 'true', VITE_ENGINE: 'mock' },
    },
  }
})
