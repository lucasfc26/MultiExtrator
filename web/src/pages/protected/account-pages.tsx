import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { z } from 'zod'
import {
  Bell,
  CheckCircle2,
  Download,
  FileCog,
  KeyRound,
  LogOut,
  Mail,
  Palette,
  Shield,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { GlassCard, CardBody, CardHeader } from '@/components/ui/card'
import { Button, ButtonLink } from '@/components/ui/button'
import { Badge, DemoBadge } from '@/components/ui/badge'
import { FormField, Input, PasswordInput, SegmentedControl, Select, Switch } from '@/components/ui/form'
import { Alert, Skeleton } from '@/components/ui/misc'
import { ConfirmDialog } from '@/components/ui/dialog'
import { ErrorState } from '@/components/feedback/feedback'
import { useSession } from '@/features/auth/session'
import { usersService } from '@/lib/api/services/users.service'
import { userMessage } from '@/lib/api/errors'
import { config } from '@/lib/config'
import { formatDate } from '@/lib/formatting'
import { changePasswordSchema, profileSchema } from '@/lib/validation/schemas'
import { historyRepo } from '@/lib/storage/history-repo'
import { resetDemoDb } from '@/mocks/db'
import { usePreferences, type DateFormat } from '@/stores/preferences'
import { toast } from '@/stores/toast'
import { qk } from '@/app/query-client'
import { cn } from '@/lib/utils/cn'
import type { AccountSettings } from '@/types/platform'

function PasswordForm() {
  const form = useForm<z.infer<typeof changePasswordSchema>>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  })
  const change = useMutation({
    mutationFn: (v: { currentPassword: string; newPassword: string }) => usersService.changePassword(v),
    onSuccess: () => {
      toast.success('Senha alterada')
      form.reset()
    },
  })
  const { errors } = form.formState
  return (
    <form
      noValidate
      className="grid gap-4 sm:grid-cols-3"
      onSubmit={form.handleSubmit(({ currentPassword, newPassword }) => change.mutate({ currentPassword, newPassword }))}
    >
      <FormField label="Senha atual" error={errors.currentPassword?.message}>
        {(p) => <PasswordInput {...p} autoComplete="current-password" {...form.register('currentPassword')} />}
      </FormField>
      <FormField label="Nova senha" error={errors.newPassword?.message}>
        {(p) => <PasswordInput {...p} autoComplete="new-password" {...form.register('newPassword')} />}
      </FormField>
      <FormField label="Confirmar" error={errors.confirmPassword?.message}>
        {(p) => <PasswordInput {...p} autoComplete="new-password" {...form.register('confirmPassword')} />}
      </FormField>
      {change.isError && (
        <Alert tone="danger" icon={<TriangleAlert />} className="sm:col-span-3">
          {userMessage(change.error)}
        </Alert>
      )}
      <div className="sm:col-span-3">
        <Button type="submit" loading={change.isPending}>
          Alterar senha
        </Button>
      </div>
    </form>
  )
}

export function ProfilePage() {
  const qc = useQueryClient()
  const { data: session, isPending } = useSession()
  const user = session?.user
  const form = useForm<z.infer<typeof profileSchema>>({ resolver: zodResolver(profileSchema), values: { name: user?.name ?? '' } })
  const save = useMutation({
    mutationFn: usersService.updateProfile,
    onSuccess: (u) => {
      qc.setQueryData(qk.session, { ...session!, user: u })
      toast.success('Perfil salvo')
    },
    onError: (e) => toast.error('Não foi possível salvar', userMessage(e)),
  })
  const endSessions = useMutation({
    mutationFn: usersService.endOtherSessions,
    onSuccess: () => toast.success('Outras sessões encerradas'),
    onError: (e) => toast.error('Falhou', userMessage(e)),
  })
  const exportData = useMutation({
    mutationFn: usersService.requestExport,
    onSuccess: () => toast.success('Exportação solicitada', 'Você receberá um e-mail com o link para baixar seus dados.'),
    onError: (e) => toast.error('Falhou', userMessage(e)),
  })
  const [deleting, setDeleting] = useState(false)
  const [deletePwd, setDeletePwd] = useState('')
  const del = useMutation({
    mutationFn: () => usersService.requestDeletion(deletePwd),
    onSuccess: () => {
      setDeleting(false)
      setDeletePwd('')
      toast.info('Solicitação registrada', 'Registros financeiros obrigatórios são mantidos pelo prazo legal.')
    },
  })

  if (isPending || !user) return <Skeleton className="h-96 w-full rounded-[var(--radius-card)]" />

  return (
    <>
      <PageHeader title="Perfil" badge={session.demo && <DemoBadge label="Conta demo" />} />
      <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
        <GlassCard className="flex flex-col items-center self-start p-6 text-center">
          <div className="grid size-20 place-items-center rounded-full bg-[linear-gradient(135deg,hsl(var(--accent-2)),hsl(var(--accent-strong)))] text-2xl font-semibold text-white ring-4 ring-line">
            {user.name
              .split(/\s+/)
              .slice(0, 2)
              .map((p) => p[0]?.toUpperCase())
              .join('')}
          </div>
          <p className="mt-4 font-semibold text-fg">{user.name}</p>
          <p className="text-sm text-muted">{user.email}</p>
          <Badge tone={user.emailVerified ? 'success' : 'warning'} className="mt-3">
            {user.emailVerified ? <CheckCircle2 className="size-3" /> : <Mail className="size-3" />}
            {user.emailVerified ? 'E-mail verificado' : 'E-mail não verificado'}
          </Badge>
          <dl className="mt-6 w-full border-t border-line pt-4 text-left text-sm">
            <div className="flex justify-between py-1">
              <dt className="text-muted">Cadastro</dt>
              <dd className="text-fg">{formatDate(user.createdAt, false)}</dd>
            </div>
            <div className="flex justify-between py-1">
              <dt className="text-muted">Último acesso</dt>
              <dd className="text-fg">{user.lastLoginAt ? formatDate(user.lastLoginAt) : '—'}</dd>
            </div>
          </dl>
        </GlassCard>

        <div className="flex flex-col gap-6">
          <GlassCard>
            <CardHeader title="Dados pessoais" />
            <CardBody>
              <form noValidate className="grid gap-4 sm:grid-cols-2" onSubmit={form.handleSubmit((v) => save.mutate(v))}>
                <FormField label="Nome" error={form.formState.errors.name?.message}>
                  {(p) => <Input {...p} autoComplete="name" {...form.register('name')} />}
                </FormField>
                <FormField label="E-mail" hint="A troca de e-mail exige confirmação e chega com o backend.">
                  {(p) => <Input {...p} value={user.email} disabled readOnly />}
                </FormField>
                <div className="sm:col-span-2">
                  <Button type="submit" loading={save.isPending} disabled={!form.formState.isDirty}>
                    Salvar alterações
                  </Button>
                </div>
              </form>
            </CardBody>
          </GlassCard>

          <GlassCard>
            <CardHeader title="Senha" />
            <CardBody>
              <PasswordForm />
            </CardBody>
          </GlassCard>

          <GlassCard>
            <CardHeader title="Sessões e dados" />
            <CardBody className="flex flex-col divide-y divide-line">
              <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
                <div>
                  <p className="text-sm font-medium text-fg">Encerrar outras sessões</p>
                  <p className="text-[13px] text-muted">Desconecta todos os outros dispositivos.</p>
                </div>
                <Button variant="secondary" size="sm" icon={<LogOut className="size-3.5" />} loading={endSessions.isPending} onClick={() => endSessions.mutate()}>
                  Encerrar
                </Button>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 py-4">
                <div>
                  <p className="text-sm font-medium text-fg">Exportar meus dados</p>
                  <p className="text-[13px] text-muted">Enviaremos um arquivo com seus dados pessoais.</p>
                </div>
                <Button variant="secondary" size="sm" icon={<Download className="size-3.5" />} loading={exportData.isPending} onClick={() => exportData.mutate()}>
                  Solicitar
                </Button>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 pt-4">
                <div>
                  <p className="text-sm font-medium text-danger">Excluir conta</p>
                  <p className="text-[13px] text-muted">Registros financeiros obrigatórios são mantidos pelo prazo legal.</p>
                </div>
                <Button variant="danger" size="sm" icon={<Trash2 className="size-3.5" />} onClick={() => setDeleting(true)}>
                  Solicitar exclusão
                </Button>
              </div>
            </CardBody>
          </GlassCard>
        </div>
      </div>
      <ConfirmDialog
        open={deleting}
        onClose={() => setDeleting(false)}
        onConfirm={() => del.mutate()}
        loading={del.isPending}
        title="Excluir sua conta?"
        description="Confirme com sua senha. A exclusão segue a política de retenção."
        confirmLabel="Solicitar exclusão"
      >
        <FormField label="Senha" error={del.isError ? userMessage(del.error) : undefined}>
          {(p) => <PasswordInput {...p} value={deletePwd} onChange={(e) => setDeletePwd(e.target.value)} autoComplete="current-password" />}
        </FormField>
      </ConfirmDialog>
    </>
  )
}

type Aba = 'aparencia' | 'extracoes' | 'seguranca' | 'notificacoes' | 'dados'

const ABAS: { id: Aba; label: string; icon: typeof Palette }[] = [
  { id: 'aparencia', label: 'Aparência', icon: Palette },
  { id: 'extracoes', label: 'Extrações', icon: FileCog },
  { id: 'seguranca', label: 'Segurança', icon: Shield },
  { id: 'notificacoes', label: 'Notificações', icon: Bell },
  { id: 'dados', label: 'Dados locais', icon: Trash2 },
]

function AccountSettingsForm({ section }: { section: 'extracoes' | 'notificacoes' }) {
  const settings = useQuery({ queryKey: qk.settings, queryFn: () => usersService.getSettings() })
  if (settings.isPending) return <Skeleton className="h-48 w-full" />
  if (settings.isError) return <ErrorState error={settings.error} onRetry={() => settings.refetch()} />
  // Remonta quando o servidor devolve novas preferências (depois de salvar).
  return <SettingsEditor key={settings.dataUpdatedAt} section={section} saved={settings.data} />
}

function SettingsEditor({ section, saved }: { section: 'extracoes' | 'notificacoes'; saved: AccountSettings }) {
  const qc = useQueryClient()
  const [draft, setDraft] = useState<AccountSettings>(saved)
  const save = useMutation({
    mutationFn: usersService.updateSettings,
    onSuccess: (s) => {
      qc.setQueryData(qk.settings, s)
      toast.success('Preferências salvas')
    },
    onError: (e) => toast.error('Não foi possível salvar', userMessage(e)),
  })
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved)
  const setN = (k: keyof AccountSettings['notifications'], v: boolean) =>
    setDraft({ ...draft, notifications: { ...draft.notifications, [k]: v } })

  return (
    <div className="flex flex-col">
      {section === 'extracoes' ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-4 py-3">
            <div>
              <p className="text-sm font-medium text-fg">Formato padrão de saída</p>
              <p className="text-[13px] text-muted">Destaca o botão correspondente nos resultados.</p>
            </div>
            <SegmentedControl
              label="Formato padrão"
              value={draft.defaultOutput}
              onChange={(v) => setDraft({ ...draft, defaultOutput: v })}
              options={[
                { value: 'json', label: 'JSON' },
                { value: 'csv', label: 'CSV' },
              ]}
            />
          </div>
          <Switch
            checked={draft.notifications.inAppExtraction}
            onChange={(v) => setN('inAppExtraction', v)}
            label="Notificar quando uma extração terminar"
            description="Na central de notificações."
          />
        </>
      ) : (
        <div className="divide-y divide-line">
          <Switch checked={draft.notifications.emailExtraction} onChange={(v) => setN('emailExtraction', v)} label="E-mail: extrações" description="Conclusões e falhas." />
          <Switch checked={draft.notifications.emailCredits} onChange={(v) => setN('emailCredits', v)} label="E-mail: créditos" description="Saldo baixo e compras." />
          <Switch checked={draft.notifications.emailSecurity} onChange={(v) => setN('emailSecurity', v)} label="E-mail: segurança" description="Novas chaves, troca de senha e acessos." />
          <Switch checked={draft.notifications.inAppExtraction} onChange={(v) => setN('inAppExtraction', v)} label="Central: extrações" description="Avisos dentro do painel." />
        </div>
      )}
      <div className="mt-4 flex gap-2 border-t border-line pt-4">
        <Button loading={save.isPending} disabled={!dirty} onClick={() => save.mutate(draft)}>
          Salvar
        </Button>
        <Button variant="ghost" disabled={!dirty} onClick={() => setDraft(saved)}>
          Descartar
        </Button>
      </div>
    </div>
  )
}

export function SettingsPage() {
  const [params, setParams] = useSearchParams()
  const aba = (params.get('aba') as Aba) ?? 'aparencia'
  const { theme, setTheme, dateFormat, setDateFormat, compactTables, setCompactTables } = usePreferences()
  const qc = useQueryClient()
  const [confirmClear, setConfirmClear] = useState(false)
  const clear = useMutation({
    mutationFn: async () => {
      await historyRepo.clear()
      if (config.useMocks) resetDemoDb()
    },
    onSuccess: () => {
      setConfirmClear(false)
      void qc.invalidateQueries()
      toast.success('Dados locais apagados')
    },
  })

  return (
    <>
      <PageHeader title="Configurações" />
      <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
        <nav aria-label="Categorias" className="lg:sticky lg:top-24 lg:self-start">
          <ul className="flex gap-1 overflow-x-auto lg:flex-col">
            {ABAS.map((a) => (
              <li key={a.id}>
                <button
                  onClick={() => setParams({ aba: a.id }, { replace: true })}
                  aria-current={aba === a.id ? 'page' : undefined}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm whitespace-nowrap transition-colors',
                    aba === a.id ? 'bg-fg/[0.07] font-medium text-fg' : 'text-muted hover:text-fg',
                  )}
                >
                  <a.icon className="size-4" /> {a.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <GlassCard>
          {aba === 'aparencia' && (
            <>
              <CardHeader title="Aparência" description="Preferências visuais ficam salvas neste navegador." />
              <CardBody className="divide-y divide-line">
                <div className="flex flex-wrap items-center justify-between gap-4 pb-4">
                  <p className="text-sm font-medium text-fg">Tema</p>
                  <SegmentedControl
                    label="Tema"
                    value={theme}
                    onChange={setTheme}
                    options={[
                      { value: 'dark', label: 'Escuro' },
                      { value: 'light', label: 'Claro' },
                    ]}
                  />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-4 py-4">
                  <div>
                    <p className="text-sm font-medium text-fg">Idioma</p>
                    <p className="text-[13px] text-muted">Outros idiomas ainda não estão disponíveis.</p>
                  </div>
                  <Select aria-label="Idioma" className="h-9 w-48" value="pt-BR" disabled>
                    <option value="pt-BR">Português (Brasil)</option>
                  </Select>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-4 py-4">
                  <p className="text-sm font-medium text-fg">Formato de data</p>
                  <Select aria-label="Formato de data" className="h-9 w-48" value={dateFormat} onChange={(e) => setDateFormat(e.target.value as DateFormat)}>
                    <option value="short">29/10/2026 14:30</option>
                    <option value="long">29 de out. de 2026</option>
                    <option value="iso">2026-10-29 14:30</option>
                  </Select>
                </div>
                <div className="pt-1">
                  <Switch checked={compactTables} onChange={setCompactTables} label="Tabelas compactas" description="Linhas mais baixas no histórico e nas listas." />
                </div>
              </CardBody>
            </>
          )}
          {aba === 'extracoes' && (
            <>
              <CardHeader title="Extrações" description="Salvas na sua conta." action={config.useMocks && <DemoBadge />} />
              <CardBody>
                <AccountSettingsForm section="extracoes" />
              </CardBody>
            </>
          )}
          {aba === 'notificacoes' && (
            <>
              <CardHeader title="Notificações" description="O envio de e-mail depende do serviço de e-mail do backend." action={config.useMocks && <DemoBadge />} />
              <CardBody>
                <AccountSettingsForm section="notificacoes" />
              </CardBody>
            </>
          )}
          {aba === 'seguranca' && (
            <>
              <CardHeader title="Segurança" />
              <CardBody className="flex flex-col gap-6">
                <div>
                  <p className="mb-3 text-sm font-medium text-fg">Alterar senha</p>
                  <PasswordForm />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
                  <div>
                    <p className="text-sm font-medium text-fg">API keys</p>
                    <p className="text-[13px] text-muted">Crie e revogue chaves de integração.</p>
                  </div>
                  <ButtonLink to="/app/api" variant="secondary" size="sm" icon={<KeyRound className="size-3.5" />}>
                    Gerenciar
                  </ButtonLink>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
                  <div>
                    <p className="text-sm font-medium text-fg">Autenticação em dois fatores</p>
                    <p className="text-[13px] text-muted">Ainda não suportada pelo backend.</p>
                  </div>
                  <Badge>Em breve</Badge>
                </div>
              </CardBody>
            </>
          )}
          {aba === 'dados' && (
            <>
              <CardHeader title="Dados locais" description="O que este navegador guarda." />
              <CardBody className="flex flex-col gap-4 text-sm text-muted">
                <ul className="list-disc space-y-1 pl-5">
                  <li>Histórico de extrações e PDFs (IndexedDB), apagados após {config.retencaoLocalDias} dias.</li>
                  <li>Preferências visuais (tema, formato de data).</li>
                  {config.useMocks && <li>Dados demonstrativos da conta, créditos, chaves e notificações.</li>}
                </ul>
                <div>
                  <Button variant="danger" icon={<Trash2 className="size-4" />} onClick={() => setConfirmClear(true)}>
                    Apagar histórico{config.useMocks ? ' e dados demo' : ''}
                  </Button>
                </div>
              </CardBody>
            </>
          )}
        </GlassCard>
      </div>
      <ConfirmDialog
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        onConfirm={() => clear.mutate()}
        loading={clear.isPending}
        title="Apagar dados locais?"
        description="O histórico e os PDFs deste navegador serão removidos. Não dá para desfazer."
        confirmLabel="Apagar"
      />
    </>
  )
}
