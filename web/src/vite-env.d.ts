/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ENGINE?: 'worker' | 'n8n' | 'mock' | 'platform'
  readonly VITE_USE_MOCKS?: string
  readonly VITE_API_BASE_URL?: string
  readonly VITE_API_TIMEOUT_MS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
