import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import {
  ArrowRight,
  Building2,
  Check,
  Download,
  FileText,
  Globe,
  ListChecks,
  ScanText,
  Send,
  Server,
  Smartphone,
  Workflow,
} from 'lucide-react'
import { cn } from '@/lib/utils/cn'

/**
 * Ilustração animada da tela de login/cadastro: o caminho da fatura em 4
 * etapas. Ritmo calmo (só fades e acendimentos) para não competir com o
 * formulário. Com "menos movimento", mostra a última etapa parada.
 */

const STEPS = [
  { icon: ListChecks, title: 'Escolha as faturas', desc: 'UCs e meses que você quer buscar.' },
  { icon: Workflow, title: 'Fluxo identificado', desc: 'Enel, Corporativo ou 2 VIA, automaticamente.' },
  { icon: ScanText, title: 'Dados extraídos', desc: 'Valores, vencimento, consumo e tributos.' },
  { icon: Send, title: 'Entregue onde precisar', desc: 'Download no painel ou direto no seu sistema via API.' },
] as const

const STEP_MS = 2800

/** Aparece com atraso (sequência dentro de uma etapa). */
function In({ delay, children, className }: { delay: number; children: ReactNode; className?: string }) {
  return (
    <div
      className={cn('opacity-0 motion-safe:animate-[fade-in_280ms_ease-out_forwards] motion-reduce:opacity-100', className)}
      style={{ animationDelay: `${delay}ms` } as CSSProperties}
    >
      {children}
    </div>
  )
}

function Tick({ delay }: { delay: number }) {
  return (
    <span className="relative grid size-4 shrink-0 place-items-center rounded border border-line-strong bg-surface">
      <In delay={delay} className="absolute inset-0 grid place-items-center rounded bg-accent">
        <Check className="size-3 text-white" strokeWidth={3} />
      </In>
    </span>
  )
}

function StepFaturas() {
  const rows = [
    { uc: 'UC 0012 3456', ref: '06/2026 · 07/2026' },
    { uc: 'UC 0098 7654', ref: '07/2026' },
    { uc: 'UC 0045 1122', ref: '07/2026' },
  ]
  return (
    <div className="flex flex-col gap-2">
      {rows.map((r, i) => (
        <div key={r.uc} className="flex items-center gap-3 rounded-lg border border-line bg-fg/[0.02] px-3 py-2.5">
          <Tick delay={350 + i * 450} />
          <span className="font-mono text-[12.5px] text-fg">{r.uc}</span>
          <span className="ml-auto rounded-md bg-fg/[0.05] px-2 py-0.5 font-mono text-[11px] text-muted">{r.ref}</span>
        </div>
      ))}
    </div>
  )
}

function StepFluxo() {
  const flows = [
    { icon: Globe, label: 'Enel' },
    { icon: Building2, label: 'Corporativo' },
    { icon: Smartphone, label: '2 VIA' },
  ]
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-2">
        {flows.map((f, i) => (
          <div key={f.label} className="relative rounded-lg border border-line bg-fg/[0.02] px-2 py-3 text-center">
            <f.icon className="mx-auto size-4 text-subtle" />
            <p className="mt-1.5 text-[12px] text-muted">{f.label}</p>
            {i === 1 && (
              <In delay={900} className="absolute inset-0 rounded-lg border border-accent/60 bg-accent/[0.08] px-2 py-3">
                <f.icon className="mx-auto size-4 text-accent" />
                <p className="mt-1.5 text-[12px] font-medium text-fg">{f.label}</p>
              </In>
            )}
          </div>
        ))}
      </div>
      <In delay={1400} className="flex items-center gap-2 text-[12.5px] text-muted">
        <Check className="size-3.5 text-success" /> Login do agrupamento empresarial → Corporativo
      </In>
    </div>
  )
}

function StepExtracao() {
  const campos: [string, string][] = [
    ['Vencimento', '20/07/2026'],
    ['Consumo', '350 kWh'],
    ['Valor total', 'R$ 412,37'],
  ]
  return (
    <div className="grid grid-cols-[0.9fr_1.1fr] gap-3">
      <div className="relative overflow-hidden rounded-lg border border-line bg-fg/[0.02] p-3">
        <FileText className="size-4 text-accent" />
        <div className="mt-3 flex flex-col gap-2">
          {[90, 65, 80, 50, 70].map((w, i) => (
            <div key={i} className="relative h-1.5 rounded-full bg-fg/10" style={{ width: `${w}%` }}>
              {i % 2 === 1 && (
                <In delay={300 + i * 250} className="absolute inset-0 rounded-full bg-accent/70 shadow-[0_0_8px_hsl(var(--accent)/0.5)]">
                  {null}
                </In>
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        {campos.map(([k, v], i) => (
          <In key={k} delay={500 + i * 350} className="rounded-lg border border-line bg-fg/[0.02] px-3 py-1.5">
            <p className="text-[10.5px] text-subtle">{k}</p>
            <p className="font-mono text-[12.5px] font-semibold text-fg tabular-nums">{v}</p>
          </In>
        ))}
      </div>
    </div>
  )
}

function StepEntrega() {
  return (
    <div className="grid grid-cols-2 gap-3">
      <In delay={150} className="rounded-lg border border-line bg-fg/[0.02] p-3">
        <Download className="size-4 text-accent" />
        <p className="mt-2 text-[12.5px] font-medium text-fg">No painel</p>
        <div className="mt-2 flex flex-wrap gap-1">
          {['PDF', 'JSON', 'CSV'].map((t) => (
            <span key={t} className="rounded-md border border-line bg-fg/[0.04] px-1.5 py-0.5 font-mono text-[10.5px] text-muted">
              {t}
            </span>
          ))}
        </div>
      </In>
      <In delay={550} className="rounded-lg border border-success/30 bg-success/[0.05] p-3">
        <div className="flex items-center gap-1.5">
          <Send className="size-4 text-success" />
          <ArrowRight className="size-3.5 text-success motion-safe:animate-pulse" />
          <Server className="size-4 text-success" />
        </div>
        <p className="mt-2 text-[12.5px] font-medium text-fg">No seu sistema</p>
        <p className="mt-1 font-mono text-[10.5px] text-muted">API → ERP</p>
      </In>
      <In
        delay={1100}
        className="col-span-2 flex items-center gap-2 rounded-lg border border-code-line bg-code-bg px-3 py-2 font-mono text-[11px] text-code-fg"
      >
        <span className="text-code-keyword">POST</span>
        <span className="truncate text-code-muted">https://seu-erp/faturas</span>
        <span className="ml-auto shrink-0 rounded border border-success/30 bg-success/10 px-1.5 text-success">200 OK</span>
      </In>
    </div>
  )
}

const VISUALS = [StepFaturas, StepFluxo, StepExtracao, StepEntrega]

export function AuthShowcase() {
  const [reduce] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [step, setStep] = useState(() => (reduce ? STEPS.length - 1 : 0))

  useEffect(() => {
    if (reduce) return
    const t = setTimeout(() => setStep((s) => (s + 1) % STEPS.length), STEP_MS)
    return () => clearTimeout(t)
  }, [step, reduce])

  const Visual = VISUALS[step]

  return (
    <div className="w-full max-w-md">
      <p className="text-[12px] font-semibold tracking-wide text-accent uppercase">Como funciona</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-fg">Da ENEL ao seu sistema, em 4 passos.</p>

      <div className="glass-strong mt-6 rounded-2xl p-5">
        <div className="mb-4 flex items-center justify-between">
          <span className="font-mono text-[11px] text-subtle">
            {String(step + 1).padStart(2, '0')} / {String(STEPS.length).padStart(2, '0')}
          </span>
          <span className="text-[12px] font-medium text-fg">{STEPS[step].title}</span>
        </div>
        {/* Altura fixa: a troca de etapa não mexe no layout */}
        <div className="h-[168px]">
          <div key={step} className="motion-safe:animate-[fade-in_240ms_ease-out]">
            <Visual />
          </div>
        </div>
      </div>

      <ol className="mt-5 flex flex-col gap-1">
        {STEPS.map((s, i) => {
          const active = i === step
          const done = !reduce && i < step
          return (
            <li
              key={s.title}
              className={cn(
                'flex items-start gap-3 rounded-lg border-l-2 px-3 py-2 transition-colors duration-300',
                active ? 'border-accent bg-fg/[0.04]' : 'border-transparent',
              )}
            >
              <span
                className={cn(
                  'mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border text-[10.5px] font-semibold transition-colors duration-300',
                  done
                    ? 'border-success/40 bg-success/15 text-success'
                    : active
                      ? 'border-accent/50 bg-accent/15 text-accent'
                      : 'border-line-strong text-subtle',
                )}
              >
                {done ? <Check className="size-3" strokeWidth={3} /> : i + 1}
              </span>
              <div className="min-w-0">
                <p className={cn('text-sm font-medium transition-colors', active ? 'text-fg' : 'text-muted')}>{s.title}</p>
                <p className="text-[12.5px] text-subtle">{s.desc}</p>
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
