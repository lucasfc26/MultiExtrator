import { Check } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import type { ExtractionRecord } from '@/types/extraction'

type StepState = 'done' | 'current' | 'todo' | 'error'

/**
 * Etapas REAIS do motor (sem percentuais): enviado → na fila → executando
 * (→ aguardando código, só 2 VIA) → concluído.
 */
export function ExtractionProgress({ record }: { record: ExtractionRecord }) {
  const s = record.uiStatus
  const order = ['pending', 'queued', 'processing', 'awaiting_code', 'done'] as const
  const idx =
    s === 'pending' ? 0 : s === 'queued' ? 1 : s === 'processing' ? 2 : s === 'awaiting_code' ? 3 : 4
  const failed = s === 'failed' || s === 'cancelled'
  const steps = [
    { key: 'pending', label: 'Enviado' },
    { key: 'queued', label: 'Na fila' },
    { key: 'processing', label: 'Processando' },
    ...(record.fluxo === 'segunda_via' ? [{ key: 'awaiting_code', label: 'Código' }] : []),
    { key: 'done', label: failed ? 'Falha' : 'Concluído' },
  ]
  const stateOf = (key: string): StepState => {
    const i = order.indexOf(key as (typeof order)[number])
    // A 2 VIA alterna entre "processando" e "código": o passo "Código" só
    // fica concluído quando a extração termina.
    if (key === 'done') return idx === 4 ? (failed ? 'error' : 'done') : 'todo'
    if (i < idx) return 'done'
    if (i === idx) return 'current'
    return 'todo'
  }

  return (
    <ol className="flex items-center gap-2" aria-label="Etapas da busca">
      {steps.map((st, i) => {
        const state = stateOf(st.key)
        return (
          <li key={st.key} className="flex min-w-0 flex-1 items-center gap-2 last:flex-none">
            <div className="flex items-center gap-2">
              <span
                aria-current={state === 'current' ? 'step' : undefined}
                className={cn(
                  'relative grid size-6 shrink-0 place-items-center rounded-full border text-[11px] font-semibold',
                  state === 'done' && 'border-success/40 bg-success/15 text-success',
                  state === 'current' && 'border-accent/50 bg-accent/15 text-accent',
                  state === 'todo' && 'border-line-strong text-subtle',
                  state === 'error' && 'border-danger/40 bg-danger/15 text-danger',
                )}
              >
                {state === 'current' && <span className="absolute inset-0 animate-ping rounded-full bg-accent/25" />}
                {state === 'done' ? <Check className="size-3.5" /> : i + 1}
              </span>
              <span className={cn('hidden text-[13px] sm:inline', state === 'todo' ? 'text-subtle' : 'text-fg')}>{st.label}</span>
            </div>
            {i < steps.length - 1 && (
              <span className={cn('h-px flex-1', state === 'done' ? 'bg-success/40' : 'bg-line-strong')} aria-hidden />
            )}
          </li>
        )
      })}
    </ol>
  )
}
