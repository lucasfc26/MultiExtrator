/**
 * Carregadores dos chunks de cada página. O router usa estes mesmos imports
 * no React.lazy; os layouts chamam `prefetch*` com o navegador ocioso para que
 * a troca de aba não espere download.
 */
export const loaders = {
  landing: () => import('@/pages/public/landing-page'),
  auth: () => import('@/pages/public/auth-pages'),
  institutional: () => import('@/pages/public/institutional-pages'),
  statics: () => import('@/pages/shared/static-pages'),
  apiDocs: () => import('@/pages/shared/api-docs-page'),
  dashboard: () => import('@/pages/protected/dashboard-page'),
  newExtraction: () => import('@/pages/protected/new-extraction-page'),
  extractor: () => import('@/pages/protected/extractor-page'),
  history: () => import('@/pages/protected/history-pages'),
  credits: () => import('@/pages/protected/credits-pages'),
  apiKeys: () => import('@/pages/protected/api-keys-page'),
  notifications: () => import('@/pages/protected/notifications-page'),
  account: () => import('@/pages/protected/account-pages'),
  charts: () => import('@/components/charts/dashboard-charts'),
  jsonViewer: () => import('@/components/data-display/json-viewer'),
}

type Key = keyof typeof loaders

function whenIdle(fn: () => void) {
  const ric = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void })
    .requestIdleCallback
  if (ric) ric(fn, { timeout: 2000 })
  else setTimeout(fn, 300)
}

const done = new Set<Key>()

function prefetch(keys: Key[]) {
  whenIdle(() => {
    for (const k of keys) {
      if (done.has(k)) continue
      done.add(k)
      void loaders[k]().catch(() => done.delete(k))
    }
  })
}

export const prefetchApp = () =>
  prefetch([
    'dashboard',
    'newExtraction',
    'extractor',
    'history',
    'credits',
    'apiKeys',
    'notifications',
    'account',
    'statics',
    'apiDocs',
    'charts',
    'jsonViewer',
  ])

export const prefetchPublic = () => prefetch(['auth', 'institutional', 'apiDocs'])
