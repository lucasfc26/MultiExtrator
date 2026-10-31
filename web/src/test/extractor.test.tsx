import { beforeEach, describe, expect, it } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ExtractorPage from '@/pages/protected/extractor-page'
import { ContactPage, RetentionPage } from '@/pages/public/institutional-pages'
import { useExtractor } from '@/features/extractor/store'
import { resetDemoDb } from '@/mocks/db'
import { renderPage } from './utils'

const pdf = (name: string, size = 2048) => new File([new Uint8Array(size)], name, { type: 'application/pdf' })

beforeEach(() => {
  localStorage.clear()
  resetDemoDb()
  useExtractor.getState().clear()
})

describe('Extrator', () => {
  it('lista os arquivos, estima créditos e permite remover antes do envio', async () => {
    renderPage(<ExtractorPage />, '/app/extrator')
    const input = screen.getByLabelText('Selecionar faturas')
    await userEvent.upload(input, [pdf('julho.pdf'), pdf('agosto.pdf')])

    const lista = screen.getByRole('list', { name: 'Arquivos selecionados' })
    expect(within(lista).getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByText('10–16')).toBeInTheDocument() // 2 arquivos × 5–8 créditos

    await userEvent.click(screen.getByRole('button', { name: 'Remover agosto.pdf' }))
    expect(within(lista).getAllByRole('listitem')).toHaveLength(1)
  })

  it('recusa formato não aceito', async () => {
    renderPage(<ExtractorPage />, '/app/extrator')
    const txt = new File(['oi'], 'nota.txt', { type: 'text/plain' })
    await userEvent.upload(screen.getByLabelText('Selecionar faturas'), txt, { applyAccept: false })
    expect(await screen.findByText(/nota\.txt: formato não aceito/)).toBeInTheDocument()
  })

  it('envia, acompanha e mostra os dados extraídos (simulador)', async () => {
    renderPage(<ExtractorPage />, '/app/extrator')
    await userEvent.upload(screen.getByLabelText('Selecionar faturas'), pdf('fatura-julho.pdf'))
    await userEvent.click(screen.getByRole('button', { name: 'Extrair dados' }))
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Extrair dados' }))

    await waitFor(() => expect(useExtractor.getState().items[0]?.status).toBe('completed'), { timeout: 9000 })
    await userEvent.click((await screen.findAllByRole('button', { name: 'Ver dados' }))[0])
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Resultado simulado')).toBeInTheDocument()
    expect(within(dialog).getByText('Valor total')).toBeInTheDocument()
  }, 15000)

  it('aba Via API sinaliza que o contrato é previsto', async () => {
    renderPage(<ExtractorPage />, '/app/extrator')
    await userEvent.click(screen.getByRole('tab', { name: /Via API/ }))
    expect(screen.getByText('Contrato previsto')).toBeInTheDocument()
  })
})

describe('páginas institucionais', () => {
  it('contato comercial valida e confirma o envio', async () => {
    renderPage(<ContactPage />, '/contato')
    await userEvent.click(screen.getByRole('button', { name: 'Enviar mensagem' }))
    expect(await screen.findByText('Informe seu nome.')).toBeInTheDocument()
    expect(screen.getByText('É preciso concordar com o contato.')).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText('Nome'), 'Ana Lima')
    await userEvent.type(screen.getByLabelText('E-mail corporativo'), 'ana@empresa.com')
    await userEvent.type(screen.getByLabelText('Empresa'), 'Empresa X')
    await userEvent.selectOptions(screen.getByLabelText('Faturas por mês'), '500-2000')
    await userEvent.type(screen.getByLabelText('Como podemos ajudar?'), 'Queremos integrar ao ERP.')
    await userEvent.click(screen.getByRole('checkbox'))
    await userEvent.click(screen.getByRole('button', { name: 'Enviar mensagem' }))
    expect(await screen.findByText('Mensagem recebida')).toBeInTheDocument()
  })

  it('retenção lista os prazos reais', () => {
    renderPage(<RetentionPage />, '/retencao')
    expect(screen.getByText('PDFs no servidor de extração')).toBeInTheDocument()
    expect(screen.getByText('1 hora')).toBeInTheDocument()
    expect(screen.getByText('30 dias')).toBeInTheDocument()
  })
})
