import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Transform, Type } from 'class-transformer'
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator'
import type { Artifact, InvoiceEvent, InvoiceRequest } from '@prisma/client'

const REF = /^(\d{1,2}[/.-]\d{4}|\d{2}\d{4}|\d{4}-\d{1,2})$/
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value)

/** Entrada da Nova fatura. Os campos espelham o contrato do worker. */
export class CreateInvoiceDto {
  @ApiProperty({ enum: ['site_enel', 'corporativo', 'segunda_via'] })
  @IsIn(['site_enel', 'corporativo', 'segunda_via'])
  flow: 'site_enel' | 'corporativo' | 'segunda_via'

  @ApiPropertyOptional({ description: 'Login (Enel e Corporativo)' })
  @ValidateIf((o: CreateInvoiceDto) => o.flow !== 'segunda_via')
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: 'Informe o login.' })
  @MaxLength(200)
  usuario?: string

  @ApiPropertyOptional({ description: 'Senha (Enel e Corporativo). Usada só nesta busca; nunca é gravada.' })
  @ValidateIf((o: CreateInvoiceDto) => o.flow !== 'segunda_via')
  @IsString()
  @MinLength(1, { message: 'Informe a senha.' })
  @MaxLength(200)
  senha?: string

  @ApiPropertyOptional({ description: 'Nº do cliente (UC). Obrigatório no Corporativo e na 2 VIA.' })
  @ValidateIf((o: CreateInvoiceDto) => o.flow !== 'site_enel' || !!o.uc)
  @Transform(trim)
  @Matches(/\d/, { message: 'A UC deve ter números.' })
  @MaxLength(30)
  uc?: string

  @ApiPropertyOptional({ example: '07/2026' })
  @IsOptional()
  @Matches(REF, { message: 'Referência inválida (use MM/AAAA).' })
  referencia?: string

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @Matches(REF, { each: true, message: 'Referência inválida (use MM/AAAA).' })
  referencias?: string[]

  @ApiPropertyOptional({ enum: ['empresa', 'residencial'] })
  @IsOptional()
  @IsIn(['empresa', 'residencial'])
  tipo_conta?: 'empresa' | 'residencial'

  @ApiPropertyOptional({ description: 'CPF/CNPJ do titular (2 VIA)' })
  @ValidateIf((o: CreateInvoiceDto) => o.flow === 'segunda_via')
  @Transform(({ value }) => (typeof value === 'string' ? value.replace(/\D/g, '') : value))
  @Matches(/^(\d{11}|\d{14})$/, { message: 'CPF (11) ou CNPJ (14) dígitos.' })
  cpf_cnpj?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail({}, { message: 'E-mail inválido.' })
  email_segunda_via?: string

  @ApiPropertyOptional({ enum: ['email', 'telefone'] })
  @IsOptional()
  @IsIn(['email', 'telefone'])
  canal?: 'email' | 'telefone'
}

export class CodeDto {
  @IsOptional() @IsString() @MaxLength(12) codigo?: string
  @IsOptional() @IsBoolean() reenviar?: boolean
}

export class ListInvoicesQuery {
  @IsOptional() @IsString() @MaxLength(100) search?: string
  @IsOptional() @IsIn(['all', 'pending', 'queued', 'processing', 'awaiting_code', 'success', 'warning', 'failed', 'cancelled']) status?: string
  @IsOptional() @IsIn(['all', 'site_enel', 'corporativo', 'segunda_via']) flow?: string
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) from?: string
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) to?: string
  @IsOptional() @IsIn(['recent', 'oldest', 'duration']) sort?: 'recent' | 'oldest' | 'duration'
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number
}

/** Status de interface (o mesmo vocabulário dos badges do frontend). */
export function uiStatus(i: Pick<InvoiceRequest, 'state' | 'status' | 'observation'>) {
  if (i.state === 'PENDING') return 'pending'
  if (i.state === 'QUEUED') return 'queued'
  if (i.state === 'RUNNING') return 'processing'
  if (i.state === 'AWAITING_CODE') return 'awaiting_code'
  if (i.status === 'SUCCESS') return 'success'
  if (i.status === 'WARNING') return 'warning'
  if (/^Extração cancelada|^Busca cancelada/.test(i.observation)) return 'cancelled'
  return 'failed'
}

export function toInvoiceDto(i: InvoiceRequest & { events?: InvoiceEvent[]; artifacts?: Artifact[] }) {
  const now = new Date()
  return {
    id: i.id,
    jobId: i.engineJobId,
    flow: i.flow.toLowerCase(),
    uc: i.uc,
    referencias: i.referencias,
    inputSummary: i.inputSummary,
    state: i.state.toLowerCase(),
    status: i.status.toLowerCase(),
    uiStatus: uiStatus(i),
    observation: i.observation,
    durationS: i.durationS,
    codeExpiresAt: i.codeExpiresAt?.toISOString() ?? null,
    creditsReserved: i.creditsReserved,
    creditsCharged: i.creditsCharged,
    source: i.source.toLowerCase(),
    createdAt: i.createdAt.toISOString(),
    updatedAt: i.updatedAt.toISOString(),
    completedAt: i.completedAt?.toISOString() ?? null,
    events: i.events?.map((e) => ({ at: e.createdAt.toISOString(), state: e.state, status: e.status?.toLowerCase() ?? null, message: e.message })),
    files: i.artifacts?.map((a) => ({
      id: a.id,
      fileName: a.fileName,
      referencia: a.referencia,
      sizeBytes: a.sizeBytes,
      expiresAt: a.expiresAt.toISOString(),
      available: !a.deletedAt && a.expiresAt > now,
    })),
  }
}
