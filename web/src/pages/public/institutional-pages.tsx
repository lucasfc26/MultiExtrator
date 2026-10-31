import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { z } from 'zod'
import {
  BookOpen,
  Building2,
  CheckCircle2,
  Clock,
  FileText,
  FlaskConical,
  KeyRound,
  LifeBuoy,
  Mail,
  ShieldCheck,
  TriangleAlert,
  Zap,
} from 'lucide-react'
import { GlassCard, CardBody, CardHeader } from '@/components/ui/card'
import { Button, ButtonLink } from '@/components/ui/button'
import { Checkbox, FormField, Input, Select, Textarea } from '@/components/ui/form'
import { Alert } from '@/components/ui/misc'
import { contactService } from '@/lib/api/services/contact.service'
import { userMessage } from '@/lib/api/errors'
import { config } from '@/lib/config'
import { CREDIT_PACKAGES, OPERATION_COSTS } from '@/config/pricing'
import { cn } from '@/lib/utils/cn'

/* ─── Estrutura comum ──────────────────────────────────────────────────────── */

const ATUALIZADO_EM = '29 de outubro de 2026'

/** Dados da empresa ainda não definidos: aparecem destacados para revisão. */
function Pendente({ children }: { children: ReactNode }) {
  return (
    <mark className="rounded bg-accent-3/15 px-1 text-fg" title="Informação a preencher antes da publicação">
      [{children}]
    </mark>
  )
}

interface Secao {
  id: string
  titulo: string
  corpo: ReactNode
}

function DocumentPage({
  eyebrow,
  title,
  intro,
  secoes,
  icon,
  draft = true,
}: {
  eyebrow: string
  title: string
  intro: ReactNode
  secoes: Secao[]
  icon: ReactNode
  draft?: boolean
}) {
  const [ativa, setAtiva] = useState(secoes[0]?.id)
  useEffect(() => {
    const obs = new IntersectionObserver(
      (es) => {
        const v = es.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
        if (v) setAtiva(v.target.id)
      },
      { rootMargin: '-100px 0px -65% 0px' },
    )
    secoes.forEach((s) => {
      const el = document.getElementById(s.id)
      if (el) obs.observe(el)
    })
    return () => obs.disconnect()
  }, [secoes])

  return (
    <main className="relative">
      <div className="bg-aurora pointer-events-none absolute inset-x-0 top-0 -z-10 h-[420px]" aria-hidden />
      <div className="mx-auto max-w-6xl px-6 pt-32 pb-20">
        <header className="max-w-3xl">
          <p className="flex items-center gap-2 text-[13px] font-semibold tracking-wide text-accent uppercase">
            <span className="[&>svg]:size-4">{icon}</span> {eyebrow}
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-fg sm:text-[40px] sm:leading-[1.1]">{title}</h1>
          <div className="mt-4 text-[15px] leading-relaxed text-muted">{intro}</div>
          <p className="mt-4 text-xs text-subtle">Última atualização: {ATUALIZADO_EM}</p>
        </header>
        {draft && (
          <Alert tone="warning" icon={<TriangleAlert />} className="mt-8 max-w-3xl">
            Versão preliminar, ainda sem revisão jurídica. Os trechos entre colchetes precisam ser preenchidos antes da
            publicação.
          </Alert>
        )}
        <div className="mt-12 grid gap-12 lg:grid-cols-[220px_minmax(0,1fr)]">
          <nav aria-label="Nesta página" className="hidden lg:sticky lg:top-28 lg:block lg:self-start">
            <p className="mb-2 text-[11px] font-semibold tracking-wider text-subtle uppercase">Nesta página</p>
            <ul className="flex flex-col gap-0.5 border-l border-line">
              {secoes.map((s) => (
                <li key={s.id}>
                  <a
                    href={`#${s.id}`}
                    className={cn(
                      '-ml-px block border-l-2 py-1.5 pl-3 text-[13px] transition-colors',
                      ativa === s.id ? 'border-accent font-medium text-fg' : 'border-transparent text-muted hover:text-fg',
                    )}
                  >
                    {s.titulo}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <article className="flex max-w-3xl min-w-0 flex-col gap-10">
            {secoes.map((s, i) => (
              <section key={s.id} id={s.id} className="scroll-mt-28">
                <h2 className="text-xl font-semibold tracking-tight text-fg">
                  <span className="mr-2 font-mono text-sm text-accent">{String(i + 1).padStart(2, '0')}</span>
                  {s.titulo}
                </h2>
                <div className="mt-3 flex flex-col gap-3 text-[15px] leading-relaxed text-muted [&_b]:text-fg [&_li]:pl-1 [&_ul]:flex [&_ul]:list-disc [&_ul]:flex-col [&_ul]:gap-1.5 [&_ul]:pl-5">
                  {s.corpo}
                </div>
              </section>
            ))}
          </article>
        </div>
      </div>
    </main>
  )
}

/* ─── Termos de uso ────────────────────────────────────────────────────────── */

const TERMOS: Secao[] = [
  {
    id: 'aceite',
    titulo: 'Aceite',
    corpo: (
      <p>
        Ao criar uma conta ou usar a API do Fatturas, operado por <Pendente>razão social</Pendente>, CNPJ{' '}
        <Pendente>CNPJ</Pendente>, você concorda com estes termos e com a <Link to="/privacidade" className="text-accent hover:underline">Política de Privacidade</Link>.
        Se usar o serviço em nome de uma empresa, declara ter poderes para aceitá-los por ela.
      </p>
    ),
  },
  {
    id: 'servico',
    titulo: 'O serviço',
    corpo: (
      <>
        <p>O Fatturas oferece duas operações:</p>
        <ul>
          <li>
            <b>Nova fatura:</b> acessa os portais da ENEL (Enel, Agência Virtual Corporativa e 2 VIA) com os dados que
            você informa e baixa a fatura em PDF.
          </li>
          <li>
            <b>Extrator:</b> lê faturas que você envia (upload ou API) e devolve os dados em JSON ou CSV.
          </li>
        </ul>
        <p>O Fatturas não é afiliado, patrocinado nem endossado pela ENEL.</p>
      </>
    ),
  },
  {
    id: 'conta',
    titulo: 'Conta e acesso',
    corpo: (
      <ul>
        <li>Você é responsável pela confidencialidade da senha e das API keys da sua conta.</li>
        <li>Revogue imediatamente qualquer chave que possa ter vazado; requisições feitas com ela são atribuídas à sua conta.</li>
        <li>Podemos suspender contas usadas em violação destes termos ou que ponham o serviço em risco.</li>
      </ul>
    ),
  },
  {
    id: 'autorizacao',
    titulo: 'Credenciais e autorização',
    corpo: (
      <>
        <p>
          Ao informar login, senha, número de cliente (UC) ou CPF/CNPJ de terceiros, você declara ter <b>autorização do
          titular</b> para acessar e baixar as faturas em nome dele.
        </p>
        <p>
          Na 2 VIA, a ENEL envia um código de segurança ao titular. Você se compromete a obter esse código apenas com o
          consentimento dele.
        </p>
      </>
    ),
  },
  {
    id: 'creditos',
    titulo: 'Créditos e pagamentos',
    corpo: (
      <>
        <ul>
          <li>
            Pacotes: {CREDIT_PACKAGES.map((p) => `${p.credits.toLocaleString('pt-BR')} créditos por ${(p.priceCents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`).join('; ')}.
          </li>
          <li>
            Custo: Nova fatura, de {OPERATION_COSTS.fatura.min} a {OPERATION_COSTS.fatura.max} créditos por fatura; Extrator,
            de {OPERATION_COSTS.extracao.min} a {OPERATION_COSTS.extracao.max} créditos por arquivo. O valor exato é
            confirmado pelo servidor ao final de cada operação.
          </li>
          <li>Os créditos só entram no saldo depois que o pagamento é confirmado pelo provedor.</li>
          <li>
            Prazo de validade dos créditos e política de reembolso: <Pendente>definir</Pendente>.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'uso-aceitavel',
    titulo: 'Uso aceitável',
    corpo: (
      <ul>
        <li>Não use o serviço para acessar contas sem autorização do titular.</li>
        <li>Não tente contornar limites de uso, de concorrência ou de cobrança.</li>
        <li>Não envie arquivos com código malicioso nem conteúdo que não seja fatura.</li>
      </ul>
    ),
  },
  {
    id: 'disponibilidade',
    titulo: 'Disponibilidade e limitações',
    corpo: (
      <>
        <p>
          O serviço depende dos portais da ENEL e de serviços de resolução de captcha de terceiros, que podem mudar,
          bloquear acessos ou ficar fora do ar. Nesses casos a operação termina com status <b>erro</b> ou <b>atenção</b>,
          com a explicação no campo de observação.
        </p>
        <p>Os dados extraídos devem ser conferidos antes de usos que exijam exatidão, como contabilidade ou auditoria.</p>
      </>
    ),
  },
  {
    id: 'alteracoes',
    titulo: 'Alterações e foro',
    corpo: (
      <p>
        Avisaremos mudanças relevantes por e-mail ou no painel com antecedência mínima de <Pendente>prazo</Pendente>. Fica
        eleito o foro da comarca de <Pendente>cidade/UF</Pendente>.
      </p>
    ),
  },
]

export function TermsPage() {
  return (
    <DocumentPage
      eyebrow="Legal"
      icon={<FileText />}
      title="Termos de uso"
      intro="As regras para usar o Fatturas pela interface ou pela API."
      secoes={TERMOS}
    />
  )
}

/* ─── Privacidade ──────────────────────────────────────────────────────────── */

const PRIVACIDADE: Secao[] = [
  {
    id: 'controlador',
    titulo: 'Quem trata os dados',
    corpo: (
      <p>
        O controlador é <Pendente>razão social</Pendente>, CNPJ <Pendente>CNPJ</Pendente>. Encarregado (DPO):{' '}
        <Pendente>nome e e-mail do encarregado</Pendente>.
      </p>
    ),
  },
  {
    id: 'dados',
    titulo: 'Dados que tratamos',
    corpo: (
      <ul>
        <li>
          <b>Conta:</b> nome, e-mail, senha (guardada só como hash) e preferências.
        </li>
        <li>
          <b>Nova fatura:</b> login e senha dos portais da ENEL, número do cliente (UC), CPF/CNPJ do titular e e-mail que
          recebe o código da 2 VIA.
        </li>
        <li>
          <b>Faturas:</b> os PDFs baixados e os arquivos enviados ao Extrator, que contêm nome, endereço, consumo e valores.
        </li>
        <li>
          <b>Uso:</b> registros técnicos das requisições (data, status, duração), sem senhas.
        </li>
        <li>
          <b>Pagamentos:</b> tratados pelo provedor de pagamento. Não guardamos o número completo do cartão.
        </li>
      </ul>
    ),
  },
  {
    id: 'finalidades',
    titulo: 'Para que usamos',
    corpo: (
      <ul>
        <li>Executar as operações que você pede (buscar faturas e extrair dados).</li>
        <li>Cobrar créditos, emitir comprovantes e prevenir fraudes.</li>
        <li>Dar suporte e avisar sobre o andamento das operações.</li>
      </ul>
    ),
  },
  {
    id: 'senhas',
    titulo: 'Senhas e credenciais da ENEL',
    corpo: (
      <p>
        A senha do portal é usada <b>apenas durante a operação</b>. No servidor de extração ela existe em disco só enquanto o
        extrator lê o pedido; depois é apagada. Ela nunca aparece no histórico. O CPF/CNPJ aparece no histórico apenas
        mascarado.
      </p>
    ),
  },
  {
    id: 'compartilhamento',
    titulo: 'Compartilhamento',
    corpo: (
      <ul>
        <li>
          <b>ENEL:</b> os dados de acesso são enviados aos portais da ENEL para fazer o login.
        </li>
        <li>
          <b>Resolução de captcha:</b> CapSolver (Enel) e NoneCap (2 VIA) recebem apenas o desafio do captcha, não suas
          credenciais.
        </li>
        <li>
          <b>Infraestrutura e pagamentos:</b> provedores de hospedagem e o gateway de pagamento, sob contrato.
        </li>
      </ul>
    ),
  },
  {
    id: 'direitos',
    titulo: 'Seus direitos (LGPD)',
    corpo: (
      <p>
        Você pode pedir acesso, correção, portabilidade e exclusão dos seus dados pelo{' '}
        <Link to="/app/perfil" className="text-accent hover:underline">perfil</Link> ou escrevendo para{' '}
        <Pendente>e-mail de privacidade</Pendente>. Registros financeiros obrigatórios são mantidos pelo prazo legal mesmo
        após a exclusão da conta.
      </p>
    ),
  },
  {
    id: 'seguranca',
    titulo: 'Segurança',
    corpo: (
      <p>
        Conexões criptografadas (HTTPS), API keys guardadas apenas como hash, acesso restrito ao painel de operação e
        isolamento entre contas. Nenhum sistema é totalmente imune a incidentes; em caso de incidente relevante, avisaremos
        os afetados e a ANPD nos termos da lei.
      </p>
    ),
  },
  {
    id: 'retencao',
    titulo: 'Retenção',
    corpo: (
      <p>
        Os prazos de cada tipo de arquivo e registro estão na{' '}
        <Link to="/retencao" className="text-accent hover:underline">Política de Retenção de Arquivos</Link>.
      </p>
    ),
  },
]

export function PrivacyPage() {
  return (
    <DocumentPage
      eyebrow="Legal"
      icon={<ShieldCheck />}
      title="Política de privacidade"
      intro="Quais dados tratamos, por quê, com quem compartilhamos e como você exerce seus direitos."
      secoes={PRIVACIDADE}
    />
  )
}

/* ─── Retenção de arquivos ─────────────────────────────────────────────────── */

const PRAZOS: [string, string, string][] = [
  ['PDFs no servidor de extração', '1 hora', 'Apagados automaticamente após a entrega do resultado.'],
  ['Arquivos e resultados na plataforma', '30 dias', 'Aviso alguns dias antes; depois o download é desativado.'],
  ['Metadados das requisições', 'Enquanto a conta existir', 'Data, status, duração e créditos continuam no histórico.'],
  ['Execuções com erro no n8n', '7 dias', 'Guardadas com a entrada, com acesso restrito, para diagnóstico.'],
  ['Senha do portal da ENEL', 'Somente durante a operação', 'Removida do disco assim que o extrator lê o pedido.'],
  ['Registros financeiros', 'Prazo legal', 'Mantidos mesmo após a exclusão da conta.'],
]

const RETENCAO: Secao[] = [
  {
    id: 'prazos',
    titulo: 'Prazos por tipo de dado',
    corpo: (
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-line text-xs tracking-wide text-subtle uppercase">
              <th className="px-4 py-2.5 font-medium">Dado</th>
              <th className="px-4 py-2.5 font-medium">Prazo</th>
              <th className="px-4 py-2.5 font-medium">Observação</th>
            </tr>
          </thead>
          <tbody>
            {PRAZOS.map(([d, p, o]) => (
              <tr key={d} className="border-b border-line/70 last:border-0">
                <td className="px-4 py-3 font-medium text-fg">{d}</td>
                <td className="px-4 py-3 font-mono text-[13px] whitespace-nowrap text-accent">{p}</td>
                <td className="px-4 py-3">{o}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ),
  },
  {
    id: 'expiracao',
    titulo: 'O que acontece na expiração',
    corpo: (
      <ul>
        <li>Os arquivos são apagados do armazenamento por uma rotina automática.</li>
        <li>O histórico continua consultável, mas o botão de download fica desativado e explica o motivo.</li>
        <li>Para obter o arquivo de novo, faça uma nova busca ou um novo envio (consome créditos).</li>
      </ul>
    ),
  },
  {
    id: 'backups',
    titulo: 'Backups e registros técnicos',
    corpo: (
      <p>
        Cópias de segurança podem conter dados por até <Pendente>prazo dos backups</Pendente> após a exclusão, até serem
        sobrescritas. Logs técnicos não guardam senhas nem o conteúdo das faturas.
      </p>
    ),
  },
  {
    id: 'navegador',
    titulo: 'Dados guardados no seu navegador',
    corpo: (
      <p>
        Enquanto o backend da plataforma não guarda o histórico, o painel mantém o histórico e os PDFs no próprio navegador
        (IndexedDB) por 30 dias. Você pode apagar tudo em{' '}
        <Link to="/app/configuracoes?aba=dados" className="text-accent hover:underline">Configurações → Dados locais</Link>.
      </p>
    ),
  },
  {
    id: 'exclusao',
    titulo: 'Exclusão antecipada',
    corpo: (
      <p>
        Você pode excluir um registro e seus arquivos a qualquer momento pela página de detalhes. Para excluir a conta
        inteira, use o <Link to="/app/perfil" className="text-accent hover:underline">perfil</Link>.
      </p>
    ),
  },
]

export function RetentionPage() {
  return (
    <DocumentPage
      eyebrow="Legal"
      icon={<Clock />}
      title="Retenção de arquivos"
      intro="Por quanto tempo cada arquivo e registro fica disponível e o que acontece depois."
      secoes={RETENCAO}
    />
  )
}

/* ─── Suporte ──────────────────────────────────────────────────────────────── */

const PROBLEMAS: [string, string][] = [
  ['Status "erro" com login ou senha inválidos', 'Confira as credenciais direto no portal da ENEL antes de tentar de novo.'],
  ['Status "atenção" sem PDF', 'A ENEL respondeu sem fatura: ainda não gerada, zerada ou com impressão bloqueada. Tente outra referência.'],
  ['A 2 VIA não recebe o código', 'Informe o e-mail certo em "E-mail que recebe o código" ou use "Reenviar". O código vale 10 minutos.'],
  ['A busca demora', 'Cada busca abre um navegador e as demais esperam na fila. Pode levar alguns minutos.'],
  ['Arquivo recusado no Extrator', 'Use PDF, PNG ou JPG de até 10 MB. Arquivos protegidos por senha não são lidos.'],
  ['403 na API', 'A chave está ausente, errada ou foi revogada. Gere outra em API e integrações.'],
]

export function SupportContent() {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { to: '/docs', icon: BookOpen, t: 'Documentação da API', d: 'Endpoints, exemplos e códigos de erro.' },
          { to: '/retencao', icon: Clock, t: 'Retenção de arquivos', d: 'Por quanto tempo cada arquivo fica disponível.' },
          { to: '/contato', icon: Building2, t: 'Contato comercial', d: 'Volumes altos, integração e contratos.' },
        ].map((c) => (
          <Link key={c.to} to={c.to} className="glass group rounded-[var(--radius-card)] p-5 transition-colors hover:border-accent/40">
            <c.icon className="size-5 text-accent" />
            <p className="mt-3 text-sm font-semibold text-fg">{c.t}</p>
            <p className="mt-1 text-[13px] text-muted">{c.d}</p>
          </Link>
        ))}
      </div>
      <GlassCard>
        <CardHeader title="Problemas comuns" />
        <CardBody>
          <dl className="flex flex-col divide-y divide-line">
            {PROBLEMAS.map(([q, a]) => (
              <div key={q} className="py-3 first:pt-0 last:pb-0">
                <dt className="text-sm font-medium text-fg">{q}</dt>
                <dd className="mt-0.5 text-sm text-muted">{a}</dd>
              </div>
            ))}
          </dl>
        </CardBody>
      </GlassCard>
      <GlassCard>
        <CardHeader title="Falar com o suporte" />
        <CardBody className="flex flex-col gap-3 text-sm text-muted">
          <p>
            E-mail: <Pendente>e-mail de suporte</Pendente> · Horário: <Pendente>dias e horário</Pendente>
          </p>
          <p>
            Para agilizar, informe o <b className="text-fg">ID da requisição</b> (aparece nos detalhes de cada fatura) e o
            horário aproximado. <b className="text-fg">Nunca envie senhas</b> ao suporte.
          </p>
        </CardBody>
      </GlassCard>
    </div>
  )
}

export function SupportPage() {
  return (
    <main className="relative">
      <div className="bg-aurora pointer-events-none absolute inset-x-0 top-0 -z-10 h-[420px]" aria-hidden />
      <div className="mx-auto max-w-5xl px-6 pt-32 pb-20">
        <p className="flex items-center gap-2 text-[13px] font-semibold tracking-wide text-accent uppercase">
          <LifeBuoy className="size-4" /> Ajuda
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-fg sm:text-[40px]">Suporte</h1>
        <p className="mt-4 max-w-2xl text-[15px] text-muted">Resolva os problemas mais comuns ou fale com a equipe.</p>
        <div className="mt-10">
          <SupportContent />
        </div>
      </div>
    </main>
  )
}

/* ─── Contato comercial ────────────────────────────────────────────────────── */

const contatoSchema = z.object({
  name: z.string().trim().min(2, 'Informe seu nome.'),
  email: z.string().trim().email('E-mail inválido.'),
  company: z.string().trim().min(2, 'Informe a empresa.'),
  phone: z.string().trim().optional(),
  volume: z.string().min(1, 'Escolha uma faixa.'),
  message: z.string().trim().min(10, 'Conte um pouco do que você precisa (mín. 10 caracteres).').max(2000),
  consent: z.boolean().refine((v) => v, 'É preciso concordar com o contato.'),
})
type ContatoForm = z.infer<typeof contatoSchema>

export function ContactPage() {
  const form = useForm<ContatoForm>({
    resolver: zodResolver(contatoSchema),
    defaultValues: { name: '', email: '', company: '', phone: '', volume: '', message: '', consent: false },
  })
  const send = useMutation({
    mutationFn: ({ consent: _c, ...v }: ContatoForm) => contactService.sendSales(v),
  })
  const { errors } = form.formState

  return (
    <main className="relative">
      <div className="bg-aurora pointer-events-none absolute inset-x-0 top-0 -z-10 h-[420px]" aria-hidden />
      <div className="mx-auto grid max-w-6xl gap-12 px-6 pt-32 pb-20 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div>
          <p className="flex items-center gap-2 text-[13px] font-semibold tracking-wide text-accent uppercase">
            <Building2 className="size-4" /> Comercial
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-fg sm:text-[40px] sm:leading-[1.1]">
            Fale com a equipe comercial
          </h1>
          <p className="mt-4 text-[15px] text-muted">
            Para volumes acima de {CREDIT_PACKAGES.at(-1)!.credits.toLocaleString('pt-BR')} créditos por mês, integração
            dedicada ou contrato com nota fiscal.
          </p>
          <ul className="mt-8 flex flex-col gap-4">
            {[
              { icon: Zap, t: 'Volume sob medida', d: 'Pacotes acima da tabela, com preço por crédito negociado.' },
              { icon: KeyRound, t: 'Integração assistida', d: 'Ajuda para ligar a API ao seu ERP ou sistema financeiro.' },
              { icon: ShieldCheck, t: 'Contrato e LGPD', d: 'Termos de tratamento de dados e acordo de nível de serviço.' },
            ].map((b) => (
              <li key={b.t} className="flex gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-line bg-fg/[0.03] text-accent">
                  <b.icon className="size-4" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-fg">{b.t}</p>
                  <p className="text-[13px] text-muted">{b.d}</p>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-8 flex items-center gap-2 text-sm text-muted">
            <Mail className="size-4 text-accent" /> Ou escreva para <Pendente>e-mail comercial</Pendente>
          </p>
        </div>

        <GlassCard strong>
          <CardBody>
            {send.isSuccess ? (
              <div className="flex flex-col items-center py-10 text-center">
                <CheckCircle2 className="size-10 text-success" />
                <p className="mt-4 text-lg font-semibold text-fg">Mensagem recebida</p>
                <p className="mt-2 max-w-sm text-sm text-muted">
                  Protocolo <span className="font-mono text-fg">{send.data.protocol}</span>. Responderemos no e-mail
                  informado.
                </p>
                {send.data.demo && (
                  <Alert tone="success" icon={<FlaskConical />} className="mt-6 text-left">
                    Modo demonstração: a mensagem ficou só neste navegador e não foi enviada a ninguém.
                  </Alert>
                )}
                <ButtonLink to="/" variant="secondary" className="mt-6">
                  Voltar ao início
                </ButtonLink>
              </div>
            ) : (
              <form noValidate className="flex flex-col gap-4" onSubmit={form.handleSubmit((v) => send.mutate(v))}>
                {config.useMocks && (
                  <Alert tone="success" icon={<FlaskConical />}>
                    Modo demonstração: o formulário funciona, mas nada é enviado.
                  </Alert>
                )}
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField label="Nome" error={errors.name?.message}>
                    {(p) => <Input {...p} autoComplete="name" {...form.register('name')} />}
                  </FormField>
                  <FormField label="E-mail corporativo" error={errors.email?.message}>
                    {(p) => <Input {...p} type="email" autoComplete="email" {...form.register('email')} />}
                  </FormField>
                  <FormField label="Empresa" error={errors.company?.message}>
                    {(p) => <Input {...p} autoComplete="organization" {...form.register('company')} />}
                  </FormField>
                  <FormField label="Telefone" optional>
                    {(p) => <Input {...p} type="tel" autoComplete="tel" {...form.register('phone')} />}
                  </FormField>
                </div>
                <FormField label="Faturas por mês" error={errors.volume?.message}>
                  {(p) => (
                    <Select {...p} {...form.register('volume')}>
                      <option value="">Selecione</option>
                      <option value="ate-500">Até 500</option>
                      <option value="500-2000">500 a 2.000</option>
                      <option value="2000-10000">2.000 a 10.000</option>
                      <option value="10000+">Mais de 10.000</option>
                    </Select>
                  )}
                </FormField>
                <FormField label="Como podemos ajudar?" error={errors.message?.message}>
                  {(p) => <Textarea {...p} rows={5} {...form.register('message')} />}
                </FormField>
                <div>
                  <Checkbox
                    {...form.register('consent')}
                    label={
                      <>
                        Concordo em ser contatado sobre esta solicitação, conforme a{' '}
                        <Link to="/privacidade" className="text-accent hover:underline">
                          Política de Privacidade
                        </Link>
                        .
                      </>
                    }
                  />
                  {errors.consent && (
                    <p role="alert" className="mt-1.5 text-xs text-danger">
                      {errors.consent.message}
                    </p>
                  )}
                </div>
                {send.isError && (
                  <Alert tone="danger" icon={<TriangleAlert />}>
                    {userMessage(send.error)}
                  </Alert>
                )}
                <Button type="submit" size="lg" loading={send.isPending}>
                  Enviar mensagem
                </Button>
              </form>
            )}
          </CardBody>
        </GlassCard>
      </div>
    </main>
  )
}
