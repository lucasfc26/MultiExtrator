import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BookOpen, KeyRound, Plus, ShieldAlert, TriangleAlert, Webhook } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { GlassCard, CardBody, CardHeader } from '@/components/ui/card'
import { Button, ButtonLink } from '@/components/ui/button'
import { Badge, DemoBadge } from '@/components/ui/badge'
import { FormField, Input } from '@/components/ui/form'
import { Alert, CopyButton, SkeletonRows } from '@/components/ui/misc'
import { ConfirmDialog, Modal } from '@/components/ui/dialog'
import { DataTable } from '@/components/data-display/data-table'
import { EmptyState, ErrorState } from '@/components/feedback/feedback'
import { apiKeysService } from '@/lib/api/services/api-keys.service'
import { userMessage } from '@/lib/api/errors'
import { config } from '@/lib/config'
import { formatDate, formatRelative } from '@/lib/formatting'
import { qk } from '@/app/query-client'
import { toast } from '@/stores/toast'
import type { ApiKey, CreatedApiKey } from '@/types/platform'

const nameSchema = z.object({ name: z.string().trim().min(2, 'Dê um nome para identificar a chave.').max(60) })

function CreateKeyModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const [created, setCreated] = useState<CreatedApiKey | null>(null)
  const form = useForm<z.infer<typeof nameSchema>>({ resolver: zodResolver(nameSchema), defaultValues: { name: '' } })
  const create = useMutation({
    mutationFn: (name: string) => apiKeysService.create(name),
    onSuccess: (r) => {
      setCreated(r)
      void qc.invalidateQueries({ queryKey: qk.apiKeys })
    },
  })
  const close = () => {
    setCreated(null)
    form.reset()
    create.reset()
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title={created ? 'Chave criada' : 'Nova API key'}
      description={created ? 'Copie agora: o segredo completo não será mostrado de novo.' : 'Use uma chave por sistema para poder revogar separadamente.'}
      footer={
        created ? (
          <Button onClick={close}>Já copiei</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={close}>
              Cancelar
            </Button>
            <Button type="submit" form="create-key" loading={create.isPending}>
              Criar chave
            </Button>
          </>
        )
      }
    >
      {created ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 rounded-xl border border-success/30 bg-success/[0.06] p-2 pl-3">
            <code className="flex-1 font-mono text-[13px] break-all text-fg">{created.secret}</code>
            <CopyButton value={created.secret} />
          </div>
          <Alert tone="warning" icon={<ShieldAlert />}>
            Guarde em um cofre de segredos. Quem tiver a chave pode fazer extrações em nome da sua conta.
          </Alert>
        </div>
      ) : (
        <form id="create-key" noValidate onSubmit={form.handleSubmit((v) => create.mutate(v.name))} className="flex flex-col gap-3">
          <FormField label="Nome" error={form.formState.errors.name?.message} hint="Ex.: ERP produção, integração financeira">
            {(p) => <Input {...p} autoFocus {...form.register('name')} />}
          </FormField>
          {create.isError && (
            <Alert tone="danger" icon={<TriangleAlert />}>
              {userMessage(create.error)}
            </Alert>
          )}
        </form>
      )}
    </Modal>
  )
}

export default function ApiKeysPage() {
  const qc = useQueryClient()
  const keys = useQuery({ queryKey: qk.apiKeys, queryFn: () => apiKeysService.list() })
  const [creating, setCreating] = useState(false)
  const [revoking, setRevoking] = useState<ApiKey | null>(null)
  const revoke = useMutation({
    mutationFn: (id: string) => apiKeysService.revoke(id),
    onSuccess: (k) => {
      void qc.invalidateQueries({ queryKey: qk.apiKeys })
      toast.success('Chave revogada', `"${k.name}" não autentica mais nenhuma requisição.`)
      setRevoking(null)
    },
    onError: (e) => toast.error('Não foi possível revogar', userMessage(e)),
  })

  return (
    <>
      <PageHeader
        title="API e integrações"
        description="Chaves para chamar a API sem passar pelo painel."
        badge={config.useMocks && <DemoBadge label="Chaves demonstrativas" />}
        actions={
          <>
            <ButtonLink to="/app/docs" variant="secondary" icon={<BookOpen className="size-4" />}>
              Documentação
            </ButtonLink>
            <Button icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
              Nova chave
            </Button>
          </>
        }
      />

      <Alert tone="info" icon={<Webhook />} className="mb-6" title="Hoje, a chave real fica no n8n">
        Os webhooks atuais (<code className="font-mono text-xs">/webhook/enel/*</code>) autenticam com a credencial{' '}
        <b className="text-fg">MultiExtractor API Key</b> configurada no próprio n8n. As chaves desta página serão
        emitidas pelo backend da plataforma{config.useMocks ? ' — por enquanto são demonstrativas e não autenticam nada' : ''}.
      </Alert>

      <GlassCard>
        <CardHeader title="Suas chaves" />
        <div className="mt-4">
          {keys.isPending ? (
            <SkeletonRows className="px-6 pb-6" rows={3} />
          ) : keys.isError ? (
            <ErrorState error={keys.error} onRetry={() => keys.refetch()} />
          ) : keys.data.length === 0 ? (
            <EmptyState
              icon={<KeyRound />}
              title="Nenhuma chave"
              description="Crie uma chave para integrar seu sistema."
              action={<Button onClick={() => setCreating(true)}>Criar chave</Button>}
            />
          ) : (
            <DataTable
              caption="API keys"
              rows={keys.data}
              rowKey={(k) => k.id}
              mobileTitle={(k) => k.name}
              columns={[
                { key: 'nome', header: 'Nome', cell: (k) => <span className="font-medium text-fg">{k.name}</span>, hideOnMobile: true },
                { key: 'prefixo', header: 'Chave', cell: (k) => <code className="font-mono text-xs">{k.prefix}…</code> },
                { key: 'status', header: 'Status', cell: (k) => <Badge tone={k.status === 'active' ? 'success' : 'neutral'}>{k.status === 'active' ? 'Ativa' : 'Revogada'}</Badge> },
                { key: 'perm', header: 'Permissões', cell: (k) => <span className="text-xs">{k.scopes.join(', ')}</span>, hideOnMobile: true },
                { key: 'criada', header: 'Criada em', cell: (k) => formatDate(k.createdAt, false) },
                { key: 'uso', header: 'Último uso', cell: (k) => (k.lastUsedAt ? formatRelative(k.lastUsedAt) : 'Nunca') },
                {
                  key: 'acao',
                  header: <span className="sr-only">Ações</span>,
                  cell: (k) =>
                    k.status === 'active' ? (
                      <Button variant="ghost" size="sm" className="text-danger hover:bg-danger/10 hover:text-danger" onClick={() => setRevoking(k)}>
                        Revogar
                      </Button>
                    ) : null,
                  mobileLabel: 'Ação',
                },
              ]}
            />
          )}
        </div>
      </GlassCard>

      <GlassCard className="mt-6">
        <CardHeader title="Limites" description="Valores atuais do motor de extração." />
        <CardBody>
          <ul className="grid gap-3 text-sm sm:grid-cols-3">
            {[
              ['Extrações simultâneas', 'MAX_JOBS_SIMULTANEOS (padrão 1); as demais esperam na fila'],
              ['Tempo limite', '20 min por extração, sem contar a espera do código'],
              ['Código da 2 VIA', 'até 10 min para enviar'],
            ].map(([k, v]) => (
              <li key={k} className="rounded-xl border border-line bg-fg/[0.02] p-4">
                <p className="font-medium text-fg">{k}</p>
                <p className="mt-1 text-[13px] text-muted">{v}</p>
              </li>
            ))}
          </ul>
        </CardBody>
      </GlassCard>

      <CreateKeyModal open={creating} onClose={() => setCreating(false)} />
      <ConfirmDialog
        open={!!revoking}
        onClose={() => setRevoking(null)}
        onConfirm={() => revoking && revoke.mutate(revoking.id)}
        loading={revoke.isPending}
        title={`Revogar "${revoking?.name}"?`}
        description="Os sistemas que usam esta chave passam a receber 403 imediatamente. Não dá para reativar: será preciso criar outra."
        confirmLabel="Revogar chave"
      />
    </>
  )
}
