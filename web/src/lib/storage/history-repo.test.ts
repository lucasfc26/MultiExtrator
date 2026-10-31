import { beforeEach, describe, expect, it } from 'vitest'
import { filterRecords, historyRepo } from './history-repo'
import { makeRecord } from '@/test/utils'

const dia = (d: number) => new Date(2026, 9, d, 12).toISOString()

const records = [
  makeRecord({ id: 'a1', criadoEm: dia(1), uiStatus: 'success', fluxo: 'site_enel', uc: '111', duracaoS: 30 }),
  makeRecord({ id: 'b2', criadoEm: dia(5), uiStatus: 'failed', fluxo: 'corporativo', uc: '222', arquivos: [], duracaoS: 300 }),
  makeRecord({ id: 'c3', criadoEm: dia(10), uiStatus: 'warning', fluxo: 'segunda_via', uc: '333', duracaoS: 10 }),
  ...Array.from({ length: 12 }, (_, i) => makeRecord({ id: `x${i}`, criadoEm: dia(20), uc: '999' })),
]

describe('filterRecords', () => {
  it('filtra por status e tipo', () => {
    expect(filterRecords(records, { status: 'failed' }).items.map((r) => r.id)).toEqual(['b2'])
    expect(filterRecords(records, { fluxo: 'segunda_via' }).items.map((r) => r.id)).toEqual(['c3'])
  })

  it('busca por UC, ID ou nome de arquivo', () => {
    expect(filterRecords(records, { search: '222' }).total).toBe(1)
    expect(filterRecords(records, { search: 'c3' }).items[0].id).toBe('c3')
    expect(filterRecords(records, { search: '07.2026' }).total).toBe(14)
  })

  it('filtra por período (inclusivo)', () => {
    const r = filterRecords(records, { from: '2026-10-05', to: '2026-10-10' })
    expect(r.items.map((x) => x.id).sort()).toEqual(['b2', 'c3'])
  })

  it('ordena e pagina', () => {
    const p1 = filterRecords(records, { sort: 'oldest', pageSize: 10 })
    expect(p1.items[0].id).toBe('a1')
    expect(p1.totalPages).toBe(2)
    const p2 = filterRecords(records, { sort: 'oldest', pageSize: 10, page: 2 })
    expect(p2.items).toHaveLength(5)
    expect(filterRecords(records, { sort: 'duration' }).items[0].id).toBe('b2')
  })

  it('limita a página ao total', () => {
    expect(filterRecords(records, { page: 99, pageSize: 10 }).page).toBe(2)
  })
})

describe('historyRepo', () => {
  beforeEach(() => historyRepo.clear())

  it('apaga PDFs vencidos e mantém os metadados', async () => {
    const r = makeRecord({ id: 'old', expiraEm: new Date(Date.now() - 1000).toISOString() })
    await historyRepo.put(r)
    await historyRepo.saveFile('old', r.arquivos[0].nome, new Blob(['%PDF']))
    expect(await historyRepo.purgeExpired()).toBe(1)
    const depois = await historyRepo.get('old')
    expect(depois?.arquivosDisponiveis).toBe(false)
    expect(await historyRepo.getFile('old', r.arquivos[0].nome)).toBeUndefined()
  })
})
