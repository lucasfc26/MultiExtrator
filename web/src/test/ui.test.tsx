import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeToggle } from '@/components/layout/theme-toggle'
import { DataTable } from '@/components/data-display/data-table'
import { StatusBadge } from '@/components/data-display/status-badge'
import { ErrorState } from '@/components/feedback/feedback'
import { CreditPackageCard } from '@/pages/protected/credits-pages'
import NotificationsPage from '@/pages/protected/notifications-page'
import { ApiError } from '@/lib/api/errors'
import { DEMO_PACKAGES, resetDemoDb } from '@/mocks/db'
import { usePreferences } from '@/stores/preferences'
import { renderPage } from './utils'

beforeEach(() => {
  localStorage.clear()
  resetDemoDb()
})

describe('tema', () => {
  it('alterna entre escuro e claro e persiste no navegador', async () => {
    usePreferences.getState().setTheme('dark')
    render(<ThemeToggle />)
    expect(document.documentElement).toHaveClass('dark')
    await userEvent.click(screen.getByRole('button', { name: 'Ativar tema claro' }))
    expect(document.documentElement).not.toHaveClass('dark')
    expect(JSON.parse(localStorage.getItem('me-prefs')!).state.theme).toBe('light')
  })
})

describe('DataTable', () => {
  const rows = [
    { id: '1', nome: 'Alfa' },
    { id: '2', nome: 'Beta' },
  ]
  it('renderiza tabela (desktop) e cartões (celular) e abre a linha pelo teclado', async () => {
    const onRow = vi.fn()
    render(
      <DataTable
        rows={rows}
        rowKey={(r) => r.id}
        onRowClick={onRow}
        columns={[{ key: 'nome', header: 'Nome', cell: (r) => r.nome }]}
      />,
    )
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(2) // layout de cartões
    const linha = screen.getAllByRole('row')[1]
    linha.focus()
    await userEvent.keyboard('{Enter}')
    expect(onRow).toHaveBeenCalledWith(rows[0])
  })
})

describe('estados', () => {
  it('ErrorState mostra a mensagem da API e permite tentar de novo', async () => {
    const retry = vi.fn()
    render(<ErrorState error={new ApiError('unavailable', 'Worker fora do ar')} onRetry={retry} />)
    expect(screen.getByText('Worker fora do ar')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    expect(retry).toHaveBeenCalled()
  })

  it('StatusBadge traduz o status', () => {
    render(<StatusBadge status="awaiting_code" />)
    expect(screen.getByText('Aguardando código')).toBeInTheDocument()
  })
})

describe('créditos', () => {
  it('cartão de pacote mostra preço unitário e dispara a compra', async () => {
    const onBuy = vi.fn()
    render(<CreditPackageCard pkg={DEMO_PACKAGES[0]} onBuy={onBuy} />)
    expect(screen.getByText(/R\$\s?0,12\d\/crédito/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Comprar' }))
    expect(onBuy).toHaveBeenCalledOnce()
  })
})

describe('notificações', () => {
  it('filtra não lidas e marca todas como lidas', async () => {
    renderPage(<NotificationsPage />)
    expect(await screen.findByText('Saldo baixo (demo)')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: /Não lidas/ }))
    await waitFor(() => expect(screen.queryByText('Nova API key criada (demo)')).not.toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: 'Marcar todas como lidas' }))
    expect(await screen.findByText('Tudo lido')).toBeInTheDocument()
  })
})

describe('tabela de preços', () => {
  it('pacotes e custos por operação conforme a tabela comercial', async () => {
    const { CREDIT_PACKAGES, OPERATION_COSTS, estimate, savingsVsBase } = await import('@/config/pricing')
    expect(CREDIT_PACKAGES.map((p) => [p.credits, p.priceCents])).toEqual([
      [400, 4900],
      [6000, 59900],
      [12000, 99900],
    ])
    expect(OPERATION_COSTS.fatura).toMatchObject({ min: 2, max: 5 })
    expect(OPERATION_COSTS.extracao).toMatchObject({ min: 5, max: 8 })
    expect(estimate('fatura', 3)).toEqual({ min: 6, max: 15 })
    expect(estimate('extracao', 2)).toEqual({ min: 10, max: 16 })
    expect(savingsVsBase(CREDIT_PACKAGES[2])).toBe(32)
  })
})
