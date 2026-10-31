import { useEffect, useState, type ReactNode } from 'react'
import { CodeBlock } from '@/components/data-display/code-block'
import { GlassCard } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Alert } from '@/components/ui/misc'
import { PageHeader } from '@/components/layout/page-header'
import {
  CORPORATIVO_SAMPLES,
  RESPONSE_SAMPLE,
  SEGUNDA_VIA_SAMPLES,
  SITE_ENEL_SAMPLES,
} from '@/features/api-docs/samples'
import { cn } from '@/lib/utils/cn'
import { Info } from 'lucide-react'

/**
 * Documentação do contrato REAL dos webhooks do n8n (README.md). Os endpoints
 * futuros da plataforma (/api/v1) ainda não existem e não são documentados aqui.
 */

const SECTIONS = [
  { id: 'autenticacao', label: 'Autenticação' },
  { id: 'site-enel', label: 'Criar extração · Enel' },
  { id: 'corporativo', label: 'Criar extração · Corporativo' },
  { id: 'segunda-via', label: 'Criar extração · 2 VIA' },
  { id: 'status', label: 'Status e resultados' },
  { id: 'download', label: 'Download dos PDFs' },
  { id: 'erros', label: 'Códigos de erro' },
  { id: 'limites', label: 'Limites de utilização' },
]

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 border-b border-line pb-12 last:border-0">
      <h2 className="text-xl font-semibold tracking-tight text-fg">{title}</h2>
      <div className="mt-4 flex flex-col gap-4 text-[15px] leading-relaxed text-muted [&_code]:rounded [&_code]:bg-fg/[0.06] [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[13px] [&_code]:text-fg">
        {children}
      </div>
    </section>
  )
}

function Endpoint({ method, path }: { method: string; path: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-line bg-fg/[0.03] px-3 py-2 font-mono text-[13px]">
      <Badge tone="success" className="font-mono">
        {method}
      </Badge>
      <span className="truncate text-fg">{path}</span>
    </div>
  )
}

function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-line text-xs tracking-wide text-subtle uppercase">
            {head.map((h) => (
              <th key={h} className="px-4 py-2.5 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-line/70 last:border-0">
              {r.map((c, j) => (
                <td key={j} className="px-4 py-2.5 align-top">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function ApiDocsPage({ embedded }: { embedded?: boolean }) {
  const [active, setActive] = useState(SECTIONS[0].id)
  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (vis[0]) setActive(vis[0].target.id)
      },
      { rootMargin: '-90px 0px -60% 0px' },
    )
    SECTIONS.forEach((s) => {
      const el = document.getElementById(s.id)
      if (el) obs.observe(el)
    })
    return () => obs.disconnect()
  }, [])

  return (
    <div className={cn(!embedded && 'mx-auto max-w-6xl px-6 pt-28 pb-20')}>
      <PageHeader
        title="Documentação da API"
        description="Webhooks do n8n para os três fluxos de extração da ENEL."
        badge={<Badge tone="success">Contrato atual</Badge>}
      />
      <div className="grid gap-10 lg:grid-cols-[220px_1fr]">
        <nav aria-label="Seções da documentação" className="lg:sticky lg:top-24 lg:self-start">
          <ul className="flex gap-1 overflow-x-auto lg:flex-col">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  className={cn(
                    'block rounded-lg px-3 py-1.5 text-[13px] whitespace-nowrap transition-colors',
                    active === s.id ? 'bg-fg/[0.06] font-medium text-fg' : 'text-muted hover:text-fg',
                  )}
                >
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex min-w-0 flex-col gap-12">
          <Alert tone="info" icon={<Info />}>
            Os endpoints versionados da plataforma (<code className="font-mono text-xs">/api/v1/extractions</code>, créditos
            etc.) ainda não existem. Esta página documenta apenas o que funciona hoje.
          </Alert>

          <Section id="autenticacao" title="Autenticação">
            <p>
              Toda chamada leva o header da credencial <b className="text-fg">MultiExtractor API Key</b> configurada no n8n
              (por padrão <code>X-API-Key</code>). Sem a chave, ou com a chave errada, a resposta é <code>403</code>.
            </p>
            <p>
              As chaves do CapSolver e do NoneCap ficam no servidor: quem chama a API não as envia. A chamada fica aberta
              até a extração terminar — configure o timeout do cliente para <b className="text-fg">pelo menos 30 min</b>.
            </p>
          </Section>

          <Section id="site-enel" title="Enel">
            <Endpoint method="POST" path="/webhook/enel/site-enel" />
            <Table
              head={['Campo', 'Obrigatório', 'Descrição']}
              rows={[
                [<code>usuario</code>, 'sim', 'login da Enel'],
                [<code>senha</code>, 'sim', ''],
                [<code>uc</code>, 'não', 'nº do cliente; sem ele, a conta padrão do login'],
                [<code>referencia</code>, 'não', 'MM/AAAA; padrão: mês atual'],
                [<code>referencias</code>, 'não', 'lista de MM/AAAA (vários meses numa chamada)'],
                [<code>tipo_conta</code>, 'não', 'empresa (padrão) ou residencial'],
              ]}
            />
            <CodeBlock samples={SITE_ENEL_SAMPLES} />
          </Section>

          <Section id="corporativo" title="Corporativo (Agência Virtual)">
            <Endpoint method="POST" path="/webhook/enel/corporativo" />
            <p>
              Campos: <code>usuario</code>, <code>senha</code>, <code>uc</code> (obrigatórios; a UC precisa estar no
              agrupamento do login), <code>referencia</code> / <code>referencias</code> (opcionais).
            </p>
            <CodeBlock samples={CORPORATIVO_SAMPLES} />
          </Section>

          <Section id="segunda-via" title="2 VIA ENEL — em duas etapas">
            <Endpoint method="POST" path="/webhook/enel/segunda-via" />
            <Table
              head={['Campo', 'Obrigatório', 'Descrição']}
              rows={[
                [<code>uc</code>, 'sim', 'nº do cliente'],
                [<code>cpf_cnpj</code>, 'sim', 'do titular (com ou sem pontuação)'],
                [<code>referencia(s)</code>, 'não', 'MM/AAAA; padrão: mês atual'],
                [<code>email_segunda_via</code>, 'não', 'e-mail que deve receber o código'],
                [<code>canal</code>, 'não', 'email (padrão) ou telefone (SMS)'],
              ]}
            />
            <p>
              Depois do hCaptcha, a ENEL envia o código ao cliente e a resposta chega com <code>HTTP 202</code>, trazendo{' '}
              <code>url_codigo</code> e <code>expira_em_s</code>. Envie <code>{'{"codigo":"123456"}'}</code> para a{' '}
              <code>url_codigo</code> em até 10 minutos, com o mesmo header.
            </p>
            <ul className="list-disc pl-5">
              <li>Código recusado: a ENEL envia outro e a resposta é um novo 202 com a mesma <code>url_codigo</code>.</li>
              <li>
                Código não chegou: mande <code>{'{"reenviar": true}'}</code>.
              </li>
              <li>
                <code>409</code> (“running already”): o n8n ainda não voltou a esperar. Repita após 1–2 s.
              </li>
              <li>Sem código em 10 min, a extração é cancelada; uma nova tentativa recomeça do passo 1.</li>
            </ul>
            <CodeBlock samples={SEGUNDA_VIA_SAMPLES} />
          </Section>

          <Section id="status" title="Status e resultados">
            <p>A resposta final é igual nos três fluxos:</p>
            <CodeBlock samples={[RESPONSE_SAMPLE]} />
            <Table
              head={['status', 'Quando']}
              rows={[
                [<Badge tone="success">sucesso</Badge>, 'PDF(s) baixado(s), nada a observar'],
                [<Badge tone="warning">atencao</Badge>, 'A ENEL respondeu sem fatura ou com ressalva (zerada, não gerada, impressão bloqueada…). Pode vir com ou sem PDF'],
                [<Badge tone="danger">erro</Badge>, 'Login/senha, UC ou CPF/CNPJ inválidos, captcha não resolvido, código não informado, falha técnica'],
              ]}
            />
            <p>
              Uma fatura refaturada pode vir em dois PDFs: a cancelada, com sufixo <code>Old</code>, e a atual.
            </p>
          </Section>

          <Section id="download" title="Download dos PDFs">
            <p>
              Cada item de <code>arquivos</code> traz <code>pdf_base64</code>. Decodifique e grave com o <code>nome</code>{' '}
              indicado. No worker, os PDFs ficam disponíveis por 1 h e depois são apagados.
            </p>
          </Section>

          <Section id="erros" title="Códigos de erro">
            <Table
              head={['HTTP', 'Significado']}
              rows={[
                [<code>200</code>, 'Resultado final (inclusive status "erro" vindo da ENEL)'],
                [<code>202</code>, 'A 2 VIA está esperando o código de segurança'],
                [<code>403</code>, 'Sem a chave ou com chave errada'],
                [<code>409</code>, 'url_codigo ainda não está esperando — repita em 1–2 s'],
                [<code>422</code>, 'Dados inválidos: {"status":"erro","observacao":"..."}'],
                [<code>502</code>, 'Worker fora do ar'],
              ]}
            />
          </Section>

          <Section id="limites" title="Limites de utilização">
            <ul className="list-disc pl-5">
              <li>
                Cada extração abre um navegador inteiro. <code>MAX_JOBS_SIMULTANEOS</code> (padrão 1) define quantas rodam ao
                mesmo tempo; as demais esperam na fila.
              </li>
              <li>
                Limite de cada extração: <code>JOB_TIMEOUT_S</code> (padrão 20 min), sem contar a espera do código.
              </li>
              <li>
                Uma 2 VIA esperando o código segura a vaga por até <code>OTP_TIMEOUT_S</code> (10 min).
              </li>
              <li>A ENEL só disponibiliza os últimos 12 meses.</li>
            </ul>
            <GlassCard className="p-4 text-[13px]">
              Custo por operação: extração de 2 a 5 créditos, conversão de 5 a 8. Rate limiting por chave e o débito automático de créditos chegam com o backend da plataforma.
            </GlassCard>
          </Section>
        </div>
      </div>
    </div>
  )
}
