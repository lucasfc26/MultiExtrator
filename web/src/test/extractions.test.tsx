import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HistoryPage } from '@/pages/protected/history-pages'
import NewExtractionPage from '@/pages/protected/new-extraction-page'
import { ExtractionPanel } from '@/features/extractions/extraction-panel'
import { historyRepo } from '@/lib/storage/history-repo'
import * as dl from '@/lib/utils/download'
import { makeRecord, renderPage } from './utils'

beforeEach(async () => {
  await historyRepo.clear()
  localStorage.clear()
})

describe('histórico', () => {
  it('mostra estado vazio sem extrações', async () => {
    renderPage(<HistoryPage />, '/app/historico')
    expect(await screen.findByText('Nenhuma fatura ainda')).toBeInTheDocument()
  })

  it('filtra por status e busca, com paginação', async () => {
    for (let i = 0; i < 12; i++) await historyRepo.put(makeRecord({ id: `ok-${i}`, uc: `1000${i}` }))
    await historyRepo.put(makeRecord({ id: 'falhou', uc: '77777777', uiStatus: 'failed', status: 'erro', arquivos: [] }))

    renderPage(<HistoryPage />, '/app/historico')
    const table = await screen.findByRole('table')
    expect(within(table).getAllByRole('row')).toHaveLength(11) // cabeçalho + 10
    expect(screen.getByText('1–10 de 13')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Próxima página' }))
    expect(await screen.findByText('11–13 de 13')).toBeInTheDocument()

    await userEvent.selectOptions(screen.getByLabelText('Status'), 'failed')
    await waitFor(() => expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(2))

    await userEvent.selectOptions(screen.getByLabelText('Status'), 'all')
    await userEvent.type(screen.getByPlaceholderText('Buscar por UC, arquivo ou ID…'), '10005')
    await waitFor(() => expect(screen.getByText('1–1 de 1')).toBeInTheDocument())
  })
})

describe('resultado da extração', () => {
  it('mostra arquivos, prévia em tabela, JSON e exporta CSV', async () => {
    const spy = vi.spyOn(dl, 'downloadText').mockImplementation(() => {})
    renderPage(<ExtractionPanel record={makeRecord()} />)

    expect(screen.getByText('Fatura obtida')).toBeInTheDocument()
    expect(screen.getByText('07.2026 - 12345678.pdf')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('tab', { name: /Prévia em tabela/ }))
    expect(screen.getAllByText('07/2026').length).toBeGreaterThan(0)

    await userEvent.click(screen.getByRole('tab', { name: 'JSON' }))
    expect(await screen.findByRole('button', { name: 'Copiar JSON' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Baixar CSV' }))
    const [csv, nome] = spy.mock.calls[0]
    expect(nome).toMatch(/\.csv$/)
    expect(csv).toContain('07.2026 - 12345678.pdf')
  })

  it('desabilita o download quando os arquivos expiraram', () => {
    renderPage(<ExtractionPanel record={makeRecord({ arquivosDisponiveis: false })} />)
    expect(screen.getByText('Arquivos expirados')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'PDF' })).toBeDisabled()
  })

  it('avisa quando a expiração está próxima', () => {
    renderPage(<ExtractionPanel record={makeRecord({ expiraEm: new Date(Date.now() + 2 * 86_400_000).toISOString() })} />)
    expect(screen.getByText(/Os PDFs expiram em 2 dia/)).toBeInTheDocument()
  })

  it('pede o código quando a 2 VIA está aguardando', async () => {
    renderPage(
      <ExtractionPanel
        record={makeRecord({
          fluxo: 'segunda_via',
          estado: 'aguardando_codigo',
          status: 'aguardando_codigo',
          uiStatus: 'awaiting_code',
          observacao: 'A ENEL enviou o código.',
          expiraCodigoEm: new Date(Date.now() + 300_000).toISOString(),
        })}
      />,
    )
    expect(screen.getByText('Código de segurança')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Enviar código' }))
    expect(await screen.findByText('Informe o código recebido.')).toBeInTheDocument()
  })
})

describe('nova extração', () => {
  it('valida o formulário e confirma antes de iniciar', async () => {
    renderPage(<NewExtractionPage />, '/app/nova-fatura')
    await userEvent.click(await screen.findByRole('button', { name: 'Buscar fatura' }))
    expect(await screen.findByText('Informe o login da Enel.')).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText('Login da Enel'), 'login@empresa.com')
    await userEvent.type(screen.getByLabelText('Senha'), 'segredo')
    await userEvent.click(screen.getByRole('button', { name: 'Buscar fatura' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('login@empresa.com')).toBeInTheDocument()
    expect(within(dialog).queryByText('segredo')).not.toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Buscar fatura' }))

    expect(await screen.findByText('Acompanhamento da fatura')).toBeInTheDocument()
    expect((await historyRepo.all())[0].entradaResumo.usuario).toBe('login@empresa.com')
  })

  it('troca de fluxo e mostra os campos da 2 VIA', async () => {
    renderPage(<NewExtractionPage />, '/app/nova-fatura')
    await userEvent.click(await screen.findByRole('radio', { name: /2 VIA ENEL/ }))
    expect(screen.getByLabelText('CPF/CNPJ do titular')).toBeInTheDocument()
    expect(screen.queryByLabelText('Login da Enel')).not.toBeInTheDocument()
  })
})
