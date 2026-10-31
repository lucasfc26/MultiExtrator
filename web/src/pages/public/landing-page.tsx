import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { motion, useReducedMotion } from 'motion/react'
import {
  ArrowRight,
  Braces,
  Building2,
  Check,
  ChevronDown,
  Clock,
  Lock,
  Coins,
  Download,
  FileSpreadsheet,
  Gift,
  Globe,
  History,
  KeyRound,
  ListChecks,
  ScanText,
  ShieldCheck,
  Smartphone,
  Terminal,
  UserPlus,
  Zap,
} from 'lucide-react'
import { ButtonLink } from '@/components/ui/button'
import { GlassCard } from '@/components/ui/card'
import { CodeBlock } from '@/components/data-display/code-block'
import { HeroDemo } from '@/features/landing/hero-demo'
import { SITE_ENEL_SAMPLES } from '@/features/api-docs/samples'
import { CREDIT_PACKAGES, OPERATION_COSTS, SIGNUP_BONUS_CREDITS, formatUnitPrice, savingsVsBase } from '@/config/pricing'
import { formatCurrency } from '@/lib/formatting'
import { cn } from '@/lib/utils/cn'

function Reveal({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  const reduce = useReducedMotion()
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y: 8 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1], delay: delay * 0.5 }}
    >
      {children}
    </motion.div>
  )
}

function SectionHeading({ eyebrow, title, description }: { eyebrow: string; title: ReactNode; description?: ReactNode }) {
  return (
    <Reveal className="mx-auto max-w-2xl text-center">
      <p className="text-[13px] font-semibold tracking-wide text-accent-2 uppercase">{eyebrow}</p>
      <h2 className="mt-3 text-3xl font-semibold tracking-tight text-fg sm:text-[40px] sm:leading-[1.1]">{title}</h2>
      {description && <p className="mt-4 text-[15px] text-muted sm:text-base">{description}</p>}
    </Reveal>
  )
}

const FEATURES = [
  { icon: Zap, title: 'Busca automática de faturas', text: 'Login, captcha e download da fatura pela própria plataforma da ENEL, sem trabalho manual.' },
  { icon: ScanText, title: 'Extrator de dados', text: 'Envie faturas que você já tem e receba os campos em JSON ou CSV.' },
  { icon: FileSpreadsheet, title: 'JSON e CSV', text: 'Resposta estruturada em JSON e exportação CSV dos metadados de cada fatura.' },
  { icon: Terminal, title: 'API REST', text: 'Os mesmos fluxos por HTTP, com chave de API e respostas padronizadas.' },
  { icon: History, title: 'Histórico de requisições', text: 'Cada requisição fica registrada com status, observação, duração e linha do tempo.' },
  { icon: ListChecks, title: 'Acompanhamento de status', text: 'Na fila, em processamento, aguardando código, concluída — sem progresso inventado.' },
  { icon: Download, title: 'Download de resultados', text: 'PDFs originais da ENEL, JSON e CSV, com prazo de disponibilidade visível.' },
  { icon: Braces, title: 'Feito para desenvolvedores', text: 'Exemplos em TypeScript, Python e cURL e documentação dos códigos de retorno.' },
]

const FLOWS = [
  { icon: Globe, title: 'Enel', text: 'Usuário e senha da área do cliente. Sem UC, usa a conta padrão do login.', meta: 'reCAPTCHA resolvido no servidor' },
  { icon: Building2, title: 'Corporativo', text: 'Agência Virtual para grupos de UCs empresariais, com login e UC do agrupamento.', meta: 'Sem captcha' },
  { icon: Smartphone, title: '2 VIA ENEL', text: 'UC e CPF/CNPJ do titular. A ENEL envia um código ao cliente, que você repassa em até 10 min.', meta: 'hCaptcha + código de segurança' },
]

const STEPS = [
  { icon: UserPlus, title: 'Crie sua conta', text: 'Cadastro com e-mail e senha.' },
  { icon: Coins, title: 'Adicione créditos', text: 'Escolha um pacote e pague por PIX ou cartão.' },
  { icon: Zap, title: 'Busque ou envie faturas', text: 'Busque na ENEL ou envie o arquivo ao Extrator, pela tela ou pela API.' },
  { icon: Download, title: 'Consulte e exporte', text: 'Baixe os PDFs, o JSON e o CSV de cada requisição.' },
]

const FAQ = [
  {
    q: 'Como funciona a extração?',
    a: 'Para cada pedido, um navegador acessa a plataforma da ENEL com os dados informados, resolve o captcha quando há um e baixa o PDF da fatura. A resposta traz o status (sucesso, atenção ou erro), uma observação e os arquivos.',
  },
  {
    q: 'Quais formatos são aceitos e entregues?',
    a: 'Na Nova fatura você recebe o PDF original emitido pela ENEL. No Extrator você envia PDF, PNG ou JPG de até 10 MB e recebe os dados em JSON ou CSV.',
  },
  {
    q: 'Quanto tempo leva?',
    a: 'Normalmente alguns minutos: fila, navegador e captcha. Na 2 VIA, o tempo depende de o cliente repassar o código de segurança, que vale por 10 minutos.',
  },
  {
    q: 'Como os créditos são consumidos?',
    a: `Buscar uma fatura na ENEL custa de ${OPERATION_COSTS.fatura.min} a ${OPERATION_COSTS.fatura.max} créditos, e extrair os dados de uma fatura no Extrator, de ${OPERATION_COSTS.extracao.min} a ${OPERATION_COSTS.extracao.max}. A estimativa aparece antes do envio; o valor final é confirmado pelo servidor.`,
  },
  {
    q: 'Como uso a API?',
    a: 'Envie um POST para o endpoint do fluxo com o header da sua chave. A chamada fica aberta até o fim da extração — configure o timeout do cliente para pelo menos 30 minutos.',
  },
  {
    q: 'Como funcionam os pagamentos?',
    a: 'Por PIX ou cartão, por um gateway de pagamento. O saldo só é creditado depois que o servidor confirma o pagamento com o gateway.',
  },
  {
    q: 'Por quanto tempo os arquivos ficam disponíveis?',
    a: 'No servidor de extração, os PDFs ficam disponíveis por 1 hora e depois são apagados. Na plataforma, a política planejada é de 30 dias, com aviso antes da expiração.',
  },
  {
    q: 'O que acontece com senhas e CPF/CNPJ?',
    a: 'São usados só durante a extração. A senha existe em disco apenas enquanto o extrator lê o pedido e não aparece no histórico.',
  },
]

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-b border-line last:border-0">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-4 py-5 text-left text-[15px] font-medium text-fg"
      >
        {q}
        <ChevronDown className={cn('size-4 shrink-0 text-subtle transition-transform duration-200', open && 'rotate-180')} />
      </button>
      <div className={cn('grid transition-[grid-template-rows] duration-200 ease-[var(--ease-out-soft)]', open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}>
        <div className="overflow-hidden">
          <p className="pb-5 text-sm leading-relaxed text-muted">{a}</p>
        </div>
      </div>
    </div>
  )
}

export default function LandingPage() {
  return (
    <main>
      {/* Hero */}
      <section className="relative overflow-hidden pt-36 pb-20 sm:pt-40 sm:pb-24">
        <div className="bg-aurora absolute inset-0 -z-10" aria-hidden />
        <div className="bg-grid absolute inset-0 -z-10 opacity-60" aria-hidden />
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.08fr)] lg:gap-14">
          <Reveal className="text-center lg:text-left">
            <Link
              to="/cadastro"
              className="glass inline-flex items-center gap-2 rounded-full px-3 py-1 text-[13px] text-muted transition-colors hover:border-accent/40 hover:text-fg"
            >
              <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-semibold text-accent">
                +{SIGNUP_BONUS_CREDITS} créditos
              </span>
              grátis ao criar sua conta
              <ArrowRight className="size-3.5" />
            </Link>
            <h1 className="mt-6 text-[40px] leading-[1.05] font-semibold tracking-[-0.035em] text-fg sm:text-[52px] xl:text-[58px]">
              Transforme faturas em <span className="text-gradient">dados estruturados.</span>
            </h1>
            <p className="mx-auto mt-6 max-w-xl text-base text-muted sm:text-lg lg:mx-0">
              Extraia informações de faturas, acompanhe suas requisições e integre o processamento diretamente aos seus
              sistemas por meio de uma API.
            </p>
            <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row lg:justify-start">
              <ButtonLink to="/cadastro" size="lg" icon={<ArrowRight className="size-4" />} className="flex-row-reverse">
                Começar com {SIGNUP_BONUS_CREDITS} créditos
              </ButtonLink>
              <ButtonLink to="/docs" size="lg" variant="secondary" icon={<Terminal className="size-4" />}>
                Conhecer a API
              </ButtonLink>
            </div>
            <ul className="mt-9 flex flex-wrap justify-center gap-x-6 gap-y-2 text-[13px] text-subtle lg:justify-start">
              {[
                { icon: Lock, t: 'Senha só durante a busca' },
                { icon: Clock, t: 'Arquivos por 30 dias' },
                { icon: Braces, t: 'JSON e CSV' },
              ].map((i) => (
                <li key={i.t} className="flex items-center gap-1.5">
                  <i.icon className="size-3.5 text-accent" /> {i.t}
                </li>
              ))}
            </ul>
          </Reveal>
          <Reveal delay={0.1} className="min-w-0">
            <HeroDemo />
          </Reveal>
        </div>
      </section>

      {/* Fluxos */}
      <section className="mx-auto max-w-6xl px-6 pb-24">
        <div className="grid gap-4 md:grid-cols-3">
          {FLOWS.map((f, i) => (
            <Reveal key={f.title} delay={i * 0.08}>
              <GlassCard interactive className="h-full p-6">
                <f.icon className="size-5 text-accent-2" />
                <h3 className="mt-4 text-[15px] font-semibold text-fg">{f.title}</h3>
                <p className="mt-2 text-sm text-muted">{f.text}</p>
                <p className="mt-4 text-xs text-subtle">{f.meta}</p>
              </GlassCard>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Funcionalidades */}
      <section id="funcionalidades" className="scroll-mt-24 py-24">
        <div className="mx-auto max-w-6xl px-6">
          <SectionHeading
            eyebrow="Funcionalidades"
            title="Da fatura ao seu sistema, sem planilha no meio."
            description="Tudo o que você precisa para tirar as faturas da ENEL do portal e levar para o seu sistema."
          />
          <div className="mt-14 grid gap-px overflow-hidden rounded-[var(--radius-card)] border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((f, i) => (
              <Reveal key={f.title} delay={(i % 4) * 0.06} className="bg-bg">
                <div className="group h-full p-6 transition-colors hover:bg-fg/[0.02]">
                  <span className="grid size-9 place-items-center rounded-xl border border-line bg-fg/[0.03] text-accent transition-colors group-hover:border-accent/30">
                    <f.icon className="size-4" />
                  </span>
                  <h3 className="mt-5 text-[15px] font-semibold text-fg">{f.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{f.text}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Como funciona */}
      <section id="como-funciona" className="scroll-mt-24 py-24">
        <div className="mx-auto max-w-6xl px-6">
          <SectionHeading eyebrow="Como funciona" title="Quatro passos até o primeiro PDF." />
          <ol className="relative mt-14 grid gap-6 md:grid-cols-4">
            <div className="absolute top-6 right-[12%] left-[12%] hidden h-px bg-[linear-gradient(90deg,transparent,hsl(var(--border-strong)),transparent)] md:block" aria-hidden />
            {STEPS.map((s, i) => (
              <Reveal key={s.title} delay={i * 0.1}>
                <li className="relative flex flex-col items-center text-center">
                  <span className="glass-strong relative grid size-12 place-items-center rounded-2xl text-accent">
                    <s.icon className="size-5" />
                    <span className="absolute -top-2 -right-2 grid size-5 place-items-center rounded-full bg-accent text-[11px] font-semibold text-white">
                      {i + 1}
                    </span>
                  </span>
                  <h3 className="mt-5 text-[15px] font-semibold text-fg">{s.title}</h3>
                  <p className="mt-1.5 max-w-[220px] text-sm text-muted">{s.text}</p>
                </li>
              </Reveal>
            ))}
          </ol>
        </div>
      </section>

      {/* API */}
      <section id="api" className="scroll-mt-24 py-24">
        <div className="mx-auto grid max-w-6xl items-start gap-12 px-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <Reveal className="min-w-0 lg:pt-6">
            <p className="text-[13px] font-semibold tracking-wide text-accent-2 uppercase">Para desenvolvedores</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-fg sm:text-[40px] sm:leading-[1.1]">
              Uma chamada HTTP por fatura.
            </h2>
            <p className="mt-4 text-[15px] text-muted">
              Envie os dados de acesso e receba o PDF em base64 com o status da extração. As chaves dos captchas ficam no
              servidor: você não precisa de conta no CapSolver nem no NoneCap.
            </p>
            <ul className="mt-6 flex flex-col gap-3 text-sm text-muted">
              {[
                'Respostas 200, 202 (código da 2 VIA), 403, 422 e 502 documentadas',
                'Vários meses numa só chamada com "referencias"',
                'Fluxo em duas etapas para o código de segurança da 2 VIA',
              ].map((t) => (
                <li key={t} className="flex gap-2.5">
                  <Check className="mt-0.5 size-4 shrink-0 text-success" /> {t}
                </li>
              ))}
            </ul>
            <ButtonLink to="/docs" variant="secondary" className="mt-8" icon={<KeyRound className="size-4" />}>
              Ler a documentação
            </ButtonLink>
          </Reveal>
          <Reveal delay={0.1} className="min-w-0">
            <CodeBlock samples={SITE_ENEL_SAMPLES} title="POST /webhook/enel/site-enel" />
          </Reveal>
        </div>
      </section>

      {/* Preços */}
      <section id="precos" className="scroll-mt-24 py-24">
        <div className="mx-auto max-w-6xl px-6">
          <SectionHeading
            eyebrow="Preços"
            title="Pague pelo que extrair."
            description="Créditos sem mensalidade. Quanto maior o pacote, menor o preço por crédito."
          />
          <Reveal className="mt-6 flex justify-center">
            <Link
              to="/cadastro"
              className="inline-flex items-center gap-2 rounded-full border border-success/30 bg-success/10 px-4 py-1.5 text-[13px] font-medium text-success transition-colors hover:bg-success/15"
            >
              <Gift className="size-4" /> Comece com {SIGNUP_BONUS_CREDITS} créditos grátis — sem cartão
            </Link>
          </Reveal>
          <Reveal className="mx-auto mt-10 grid max-w-3xl gap-3 sm:grid-cols-2">
            {Object.values(OPERATION_COSTS).map((op) => (
              <div key={op.label} className="glass flex items-center justify-between gap-4 rounded-[var(--radius-card)] px-5 py-4">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-fg">{op.label}</p>
                  <p className="text-[13px] text-muted">{op.desc}</p>
                </div>
                <p className="shrink-0 text-right font-mono text-sm font-semibold text-accent tabular-nums">
                  {op.min}–{op.max}
                  <span className="block font-sans text-[11px] font-normal text-subtle">créditos</span>
                </p>
              </div>
            ))}
          </Reveal>
          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {CREDIT_PACKAGES.map((p, i) => (
              <Reveal key={p.id} delay={i * 0.08}>
                <GlassCard
                  strong={p.highlighted}
                  className={cn('relative flex h-full flex-col p-7', p.highlighted && 'border-accent/40 shadow-[0_30px_80px_-30px_hsl(var(--accent)/0.6)]')}
                >
                  {p.highlighted && (
                    <span className="absolute -top-3 left-7 rounded-full bg-[linear-gradient(135deg,hsl(var(--accent)),hsl(var(--accent-strong)))] px-3 py-1 text-[11px] font-semibold text-white">
                      Mais escolhido
                    </span>
                  )}
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-muted">{p.name}</p>
                    {savingsVsBase(p) > 0 && (
                      <span className="rounded-md border border-success/25 bg-success/10 px-2 py-0.5 text-[11px] font-semibold text-success">
                        −{savingsVsBase(p)}% por crédito
                      </span>
                    )}
                  </div>
                  <p className="mt-3 text-4xl font-semibold tracking-tight text-fg">{formatCurrency(p.priceCents)}</p>
                  <p className="mt-1 text-sm text-subtle">
                    <span className="font-mono font-semibold text-fg tabular-nums">{p.credits.toLocaleString('pt-BR')}</span> créditos ·{' '}
                    {formatUnitPrice(p)}/crédito
                  </p>
                  <ul className="mt-6 flex flex-1 flex-col gap-2.5 text-sm text-muted">
                    {p.benefits.map((b) => (
                      <li key={b} className="flex gap-2.5">
                        <Check className="mt-0.5 size-4 shrink-0 text-accent-2" /> {b}
                      </li>
                    ))}
                  </ul>
                  <ButtonLink
                    to={`/cadastro?pacote=${p.id}`}
                    variant={p.highlighted ? 'primary' : 'secondary'}
                    className="mt-8 w-full"
                  >
                    Comprar
                  </ButtonLink>
                </GlassCard>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="scroll-mt-24 py-24">
        <div className="mx-auto max-w-3xl px-6">
          <SectionHeading eyebrow="FAQ" title="Perguntas frequentes" />
          <Reveal className="mt-12">
            <GlassCard className="px-6">
              {FAQ.map((f) => (
                <FaqItem key={f.q} {...f} />
              ))}
            </GlassCard>
          </Reveal>
        </div>
      </section>

      {/* CTA */}
      <section className="px-6 pb-24">
        <Reveal>
          <div className="relative mx-auto max-w-6xl overflow-hidden rounded-[28px] border border-line-strong px-6 py-16 text-center sm:px-16">
            <div className="absolute inset-0 -z-10 bg-[radial-gradient(60%_120%_at_50%_0%,hsl(var(--accent)/0.3),transparent),radial-gradient(40%_80%_at_100%_100%,hsl(var(--accent-2)/0.2),transparent)]" />
            <ShieldCheck className="mx-auto size-7 text-accent-2" />
            <h2 className="mx-auto mt-5 max-w-2xl text-3xl font-semibold tracking-tight text-fg sm:text-4xl">
              Pare de baixar fatura por fatura.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-muted">Crie a conta e busque a primeira fatura em poucos minutos.</p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <ButtonLink to="/cadastro" size="lg">
                Começar agora
              </ButtonLink>
              <ButtonLink to="/entrar" size="lg" variant="secondary">
                Já tenho conta
              </ButtonLink>
            </div>
          </div>
        </Reveal>
      </section>
    </main>
  )
}
