import { Injectable } from '@nestjs/common'

/** Campo exibido na interface (rótulo legível + valor formatado). */
export interface ExtractedField {
  key: string
  label: string
  value: string | number | null
}

export interface ConversionInput {
  extractionId: string
  fileName: string
  mimeType: string
  data: Buffer
}

export interface ConversionResult {
  /** JSON estruturado da fatura. */
  data: Record<string, unknown>
  /** Campos principais para a prévia em tabela. */
  fields: ExtractedField[]
  /** Unidades para a cobrança (ex.: páginas). Limitado à faixa do BillingService. */
  billableUnits?: number
}

/** Erro "esperado" do conversor (arquivo ilegível, layout não suportado...): vira FAILED sem cobrança. */
export class ConversionError extends Error {}

/**
 * Contrato do conversor (Extrator). A implementação real será plugada aqui
 * sem mudar o resto da API: controller, cobrança, retenção e notificações já
 * tratam o ciclo completo.
 */
export interface ConverterAdapter {
  readonly name: string
  convert(input: ConversionInput): Promise<ConversionResult>
}

export const CONVERTER = Symbol('CONVERTER')

/** Placeholder até o conversor real existir: falha de forma explícita e sem cobrar. */
@Injectable()
export class NotConfiguredConverter implements ConverterAdapter {
  readonly name = 'nao-configurado'
  async convert(): Promise<ConversionResult> {
    throw new ConversionError('O conversor ainda não foi configurado neste ambiente. Nenhum crédito foi cobrado.')
  }
}
