import { useEffect, useState, type ReactNode } from 'react'
import { Braces, CheckCircle2, FileText, Loader2, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils/cn'

/**
 * Demonstração ILUSTRATIVA e automática: uma conta de energia fictícia é lida,
 * os campos acendem no documento e o JSON é digitado ao lado. Repete sozinha.
 * Nenhum dado real.
 */

const RESULT = `{
  "distribuidora": "ENEL",
  "numero_cliente": "00000000",
  "titular": "Empresa Exemplo Ltda",
  "referencia": "07/2026",
  "vencimento": "20/07/2026",
  "consumo_kwh": 350,
  "itens": [
    { "item": "Energia",
      "valor": 311.50 },
    { "item": "Ilum. pública",
      "valor": 18.50 }
  ],
  "icms": 56.07,
  "pis_cofins": 26.30,
  "valor_total": 412.37
}`

type Phase = 'idle' | 'reading' | 'typing' | 'done'
const PHASE_LABEL: Record<Phase, string> = {
  idle: 'Recebendo fatura-exemplo.pdf',
  reading: 'Lendo o documento',
  typing: 'Extraindo campos',
  done: 'Concluído',
}
const PHASES: Phase[] = ['idle', 'reading', 'typing', 'done']
const CHARS_PER_TICK = 6
const TICK_MS = 16

/** Realce simples de JSON: chaves, strings, números e pontuação. */
function highlight(text: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /("(?:[^"\\]|\\.)*")(\s*:)?|(-?\d+(?:\.\d+)?)|([{}[\],])/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    if (m[1] && m[2]) {
      out.push(
        <span key={m.index} className="text-code-key">
          {m[1]}
        </span>,
      )
      out.push(
        <span key={`${m.index}c`} className="text-code-muted">
          {m[2]}
        </span>,
      )
    } else if (m[1])
      out.push(
        <span key={m.index} className="text-code-string">
          {m[1]}
        </span>,
      )
    else if (m[3])
      out.push(
        <span key={m.index} className="text-code-number">
          {m[3]}
        </span>,
      )
    else
      out.push(
        <span key={m.index} className="text-code-muted">
          {m[4]}
        </span>,
      )
    last = re.lastIndex
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

/** Trecho do documento que "acende" quando o campo correspondente já apareceu no JSON. */
function Field({ on, children, className }: { on: boolean; children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        '-mx-1.5 rounded-md px-1.5 transition-[background-color,box-shadow] duration-300',
        on ? 'bg-accent/10 shadow-[inset_0_0_0_1px_hsl(var(--accent)/0.45)]' : 'shadow-[inset_0_0_0_1px_transparent]',
        className,
      )}
    >
      {children}
    </div>
  )
}

export function HeroDemo() {
  const [reduce] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [phase, setPhase] = useState<Phase>(() => (reduce ? 'done' : 'idle'))
  const [typed, setTyped] = useState(() => (reduce ? RESULT.length : 0))

  useEffect(() => {
    if (reduce) return
    let t: ReturnType<typeof setTimeout>
    if (phase === 'idle') t = setTimeout(() => setPhase('reading'), 900)
    else if (phase === 'reading') t = setTimeout(() => setPhase('typing'), 1800)
    else if (phase === 'typing') {
      if (typed < RESULT.length) t = setTimeout(() => setTyped((n) => Math.min(n + CHARS_PER_TICK, RESULT.length)), TICK_MS)
      else t = setTimeout(() => setPhase('done'), 150)
    } else
      t = setTimeout(() => {
        setTyped(0)
        setPhase('idle')
      }, 4200)
    return () => clearTimeout(t)
  }, [phase, typed, reduce])

  const visible = RESULT.slice(0, typed)
  const has = (key: string) => phase !== 'idle' && visible.includes(`"${key}"`)
  const done = phase === 'done'
  const busy = phase === 'reading' || phase === 'typing'
  const step = PHASES.indexOf(phase)

  return (
    <div className="relative w-full">
      <div
        className="absolute -inset-6 -z-10 rounded-[32px] bg-[radial-gradient(closest-side,hsl(var(--accent)/0.22),transparent)] blur-2xl"
        aria-hidden
      />
      <div
        className="glass-strong overflow-hidden rounded-2xl"
        role="img"
        aria-label="Demonstração ilustrativa: uma conta de energia fictícia sendo convertida em dados estruturados"
      >
        {/* Barra da janela */}
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <div className="flex items-center gap-1.5" aria-hidden>
            <span className="size-2.5 rounded-full bg-danger/60" />
            <span className="size-2.5 rounded-full bg-warning/60" />
            <span className="size-2.5 rounded-full bg-success/60" />
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-md border border-accent-2/30 bg-accent-2/10 px-2 py-0.5 text-[11px] font-medium text-accent-2">
            <Sparkles className="size-3" /> Exemplo ilustrativo
          </span>
        </div>

        <div className="grid sm:grid-cols-2">
          {/* Documento */}
          <div className="relative min-h-[330px] overflow-hidden border-b border-line p-5 sm:border-r sm:border-b-0">
            <div className="mb-3 flex h-5 items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-[10px] tracking-widest text-subtle uppercase">
                <FileText className="size-3" /> fatura-exemplo.pdf
              </p>
              {done && (
                <span className="inline-flex items-center gap-1 rounded-md border border-success/30 bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success motion-safe:animate-[fade-in_200ms_ease-out]">
                  <CheckCircle2 className="size-3" /> Extraído
                </span>
              )}
            </div>
            <div className="flex flex-col gap-2 text-[11px] leading-relaxed">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-fg">CONTA DE ENERGIA</span>
                <Field on={has('distribuidora')}>
                  <span className="font-semibold text-accent">ENEL</span>
                </Field>
              </div>
              <Field on={has('titular')}>
                <p className="text-muted">Empresa Exemplo Ltda</p>
              </Field>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-muted">
                <Field on={has('numero_cliente')}>
                  <span className="block text-[9.5px] text-subtle uppercase">Nº do cliente</span>
                  <span className="font-mono text-fg">00000000</span>
                </Field>
                <Field on={has('referencia')}>
                  <span className="block text-[9.5px] text-subtle uppercase">Referência</span>
                  <span className="font-mono text-fg">07/2026</span>
                </Field>
                <Field on={has('vencimento')}>
                  <span className="block text-[9.5px] text-subtle uppercase">Vencimento</span>
                  <span className="font-mono text-fg">20/07/2026</span>
                </Field>
                <Field on={has('consumo_kwh')}>
                  <span className="block text-[9.5px] text-subtle uppercase">Consumo</span>
                  <span className="font-mono text-fg">350 kWh</span>
                </Field>
              </div>
              <div className="h-px bg-line" />
              <Field on={has('itens')} className="flex flex-col gap-0.5 text-muted">
                <div className="flex justify-between">
                  <span>Consumo de energia</span>
                  <span className="font-mono">R$ 311,50</span>
                </div>
                <div className="flex justify-between">
                  <span>Ilum. pública</span>
                  <span className="font-mono">R$ 18,50</span>
                </div>
              </Field>
              <Field on={has('icms')} className="flex justify-between text-muted">
                <span>ICMS + PIS/COFINS</span>
                <span className="font-mono">R$ 82,37</span>
              </Field>
              <div className="h-px bg-line" />
              <Field on={has('valor_total')} className="flex justify-between text-xs font-semibold text-fg">
                <span>Total a pagar</span>
                <span className="font-mono">R$ 412,37</span>
              </Field>
              <div className="mt-2 flex flex-col gap-1.5" aria-hidden>
                <div className="h-1.5 w-4/5 rounded-full bg-fg/[0.07]" />
                <div className="h-1.5 w-3/5 rounded-full bg-fg/[0.07]" />
                <div className="h-1.5 w-2/3 rounded-full bg-fg/[0.07]" />
              </div>
            </div>

            {phase === 'reading' && (
              <>
                <div className="absolute inset-0 bg-accent/[0.04]" />
                <div className="pointer-events-none absolute inset-x-3 top-0 h-0.5 animate-[scan_1.8s_cubic-bezier(0.22,1,0.36,1)_infinite] rounded-full bg-[linear-gradient(90deg,transparent,hsl(var(--accent)),transparent)] shadow-[0_0_16px_2px_hsl(var(--accent)/0.6)]" />
              </>
            )}
          </div>

          {/* JSON */}
          <div className="flex min-h-[330px] min-w-0 flex-col bg-code-bg p-5">
            <p className="mb-3 flex items-center gap-1.5 text-[10px] tracking-widest text-code-muted uppercase">
              <Braces className="size-3" /> resultado.json
            </p>
            {phase === 'idle' || phase === 'reading' ? (
              <p className="font-mono text-[11px] text-code-muted">
                {'{ '}
                <span className="text-code-key">"status"</span>: <span className="text-code-string">"processing"</span>
                {' }'}
                <span className="ml-1 inline-block h-3 w-1.5 translate-y-0.5 animate-pulse bg-code-number/80" />
              </p>
            ) : (
              <pre className="flex-1 overflow-hidden font-mono text-[10.5px] leading-[1.6] whitespace-pre text-code-fg">
                {highlight(visible)}
                {!done && <span className="inline-block h-3 w-1.5 translate-y-0.5 animate-pulse bg-code-number/80" />}
              </pre>
            )}
          </div>
        </div>

        {/* Rodapé: etapa atual */}
        <div className="flex items-center gap-3 border-t border-line px-4 py-3">
          <span className="flex min-w-0 items-center gap-2 text-[12px]" aria-live="polite">
            {done ? (
              <CheckCircle2 className="size-3.5 shrink-0 text-success" />
            ) : busy ? (
              <Loader2 className="size-3.5 shrink-0 animate-spin text-accent" />
            ) : (
              <span className="size-2 shrink-0 rounded-full bg-accent motion-safe:animate-pulse" />
            )}
            <span className={cn('truncate', done ? 'text-success' : 'text-muted')}>{PHASE_LABEL[phase]}</span>
          </span>
          <ol className="ml-auto flex w-28 shrink-0 gap-1" aria-hidden>
            {PHASES.map((p, i) => (
              <li
                key={p}
                className={cn(
                  'h-1 flex-1 rounded-full transition-colors duration-300',
                  done ? 'bg-success/70' : i < step ? 'bg-accent/70' : i === step ? 'bg-accent/40' : 'bg-fg/10',
                )}
              />
            ))}
          </ol>
        </div>
      </div>
      <p className="mt-3 text-center text-[11.5px] text-subtle lg:text-left">
        Demonstração com um documento fictício — não representa dados de clientes.
      </p>
    </div>
  )
}
