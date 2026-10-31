import type { ReactElement } from 'react'
import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router-dom'
import type { ExtractionRecord } from '@/types/extraction'

export function renderRoutes(routes: RouteObject[], initial = '/') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const router = createMemoryRouter(routes, { initialEntries: [initial] })
  const utils = render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return { ...utils, router, qc }
}

export function renderPage(ui: ReactElement, path = '/', extra: RouteObject[] = []) {
  return renderRoutes([{ path, element: ui }, ...extra, { path: '*', element: <p>rota: outra</p> }], path)
}

export function makeRecord(over: Partial<ExtractionRecord> = {}): ExtractionRecord {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    jobId: 'job123',
    fluxo: 'site_enel',
    engine: 'mock',
    uc: '12345678',
    referencias: ['07/2026'],
    entradaResumo: { usuario: 'a@b.com', uc: '12345678' },
    criadoEm: now,
    atualizadoEm: now,
    concluidoEm: now,
    estado: 'concluido',
    status: 'sucesso',
    uiStatus: 'success',
    observacao: '1 fatura(s) baixada(s).',
    duracaoS: 94.3,
    arquivos: [{ nome: '07.2026 - 12345678.pdf', referencia: '07/2026', tamanho_bytes: 183214 }],
    expiraEm: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    arquivosDisponiveis: true,
    timeline: [{ at: now, estado: 'concluido', status: 'sucesso', mensagem: '1 fatura(s) baixada(s).' }],
    expiraCodigoEm: null,
    urlCodigo: null,
    respostaBruta: { status: 'sucesso' },
    demo: false,
    ...over,
  }
}
