import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import type { z } from 'zod'
import { ArrowLeft, CheckCircle2, Clock, FlaskConical, Gift, MailCheck, TriangleAlert } from 'lucide-react'
import { OPERATION_COSTS, SIGNUP_BONUS_CREDITS } from '@/config/pricing'
import { Logo } from '@/components/layout/logo'
import { ThemeToggle } from '@/components/layout/theme-toggle'
import { Button, ButtonLink } from '@/components/ui/button'
import { Checkbox, FormField, Input, PasswordInput } from '@/components/ui/form'
import { Alert } from '@/components/ui/misc'
import { GlassCard } from '@/components/ui/card'
import { useLogin } from '@/features/auth/session'
import { AuthShowcase } from '@/features/auth/auth-showcase'
import { authService } from '@/lib/api/services/auth.service'
import { userMessage } from '@/lib/api/errors'
import { config } from '@/lib/config'
import { forgotSchema, loginSchema, registerSchema, resetSchema } from '@/lib/validation/schemas'
import { toast } from '@/stores/toast'

function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="relative grid min-h-dvh lg:grid-cols-[1fr_1.05fr]">
      <div className="bg-aurora pointer-events-none fixed inset-0 -z-10" aria-hidden />
      <div className="flex flex-col px-6 py-6 sm:px-10">
        <div className="flex items-center justify-between">
          <Logo />
          <ThemeToggle />
        </div>
        <main className="mx-auto flex w-full max-w-[400px] flex-1 flex-col justify-center py-12">
          <h1 className="text-[26px] font-semibold tracking-tight text-fg">{title}</h1>
          {subtitle && <p className="mt-2 text-sm text-muted">{subtitle}</p>}
          {config.useMocks && (
            <Alert tone="success" icon={<FlaskConical />} className="mt-6">
              Modo demonstração: as contas ficam só neste navegador. Nenhum dado é enviado a um servidor.
            </Alert>
          )}
          <div className="mt-8">{children}</div>
          {footer && <div className="mt-8 text-center text-sm text-muted">{footer}</div>}
        </main>
      </div>
      <aside className="relative hidden overflow-hidden border-l border-line lg:block" aria-label="Como funciona">
        <div className="absolute inset-0 bg-[radial-gradient(70%_60%_at_30%_20%,hsl(var(--accent)/0.35),transparent),radial-gradient(60%_60%_at_90%_90%,hsl(var(--accent-2)/0.22),transparent)]" />
        <div className="bg-grid absolute inset-0 opacity-70" />
        <div className="relative flex h-full items-center justify-center p-10 xl:p-14">
          <AuthShowcase />
        </div>
      </aside>
    </div>
  )
}

export function LoginPage() {
  const login = useLogin()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? '/app'
  const form = useForm<z.infer<typeof loginSchema>>({ resolver: zodResolver(loginSchema), defaultValues: { email: '', password: '' } })
  const { errors } = form.formState

  return (
    <AuthShell
      title="Entrar"
      subtitle="Acesse seu painel de faturas."
      footer={
        <>
          Não tem conta?{' '}
          <Link to="/cadastro" className="font-medium text-accent hover:underline">
            Criar conta
          </Link>
        </>
      }
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={form.handleSubmit((v) =>
          login.mutate(v, { onSuccess: () => navigate(from, { replace: true }) }),
        )}
      >
        {login.isError && <Alert tone="danger" icon={<TriangleAlert />}>{userMessage(login.error)}</Alert>}
        <FormField label="E-mail" error={errors.email?.message}>
          {(p) => <Input {...p} type="email" autoComplete="email" placeholder="voce@empresa.com" {...form.register('email')} />}
        </FormField>
        <FormField label="Senha" error={errors.password?.message}>
          {(p) => <PasswordInput {...p} autoComplete="current-password" {...form.register('password')} />}
        </FormField>
        <div className="-mt-1 flex justify-end">
          <Link to="/recuperar-senha" className="text-[13px] text-muted hover:text-fg">
            Esqueci minha senha
          </Link>
        </div>
        <Button type="submit" size="lg" loading={login.isPending}>
          Entrar
        </Button>
      </form>
    </AuthShell>
  )
}

export function RegisterPage() {
  const [done, setDone] = useState<string | null>(null)
  const register = useMutation({ mutationFn: authService.register, onSuccess: (r) => setDone(r.email) })
  const form = useForm<z.infer<typeof registerSchema>>({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: '', email: '', password: '', confirmPassword: '', acceptTerms: false },
  })
  const { errors } = form.formState

  if (done)
    return (
      <AuthShell title="Confirme seu e-mail" subtitle={<>Enviamos um link de verificação para <b className="text-fg">{done}</b>.</>}>
        <GlassCard className="flex flex-col items-center p-8 text-center">
          <MailCheck className="size-8 text-accent-2" />
          <p className="mt-4 text-sm text-muted">Abra o link para ativar a conta. Depois, é só entrar.</p>
          <p className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-3 py-1 text-[13px] font-medium text-success">
            <Gift className="size-3.5" /> {SIGNUP_BONUS_CREDITS} créditos de boas-vindas na sua conta
          </p>
          {config.useMocks && (
            <ButtonLink to="/verificar-email?token=demo" variant="secondary" className="mt-6">
              Simular clique no link (demo)
            </ButtonLink>
          )}
          <ButtonLink to="/entrar" className="mt-3">
            Ir para o login
          </ButtonLink>
        </GlassCard>
      </AuthShell>
    )

  return (
    <AuthShell
      title="Criar conta"
      subtitle="Comece a buscar e extrair faturas em poucos minutos."
      footer={
        <>
          Já tem conta?{' '}
          <Link to="/entrar" className="font-medium text-accent hover:underline">
            Entrar
          </Link>
        </>
      }
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={form.handleSubmit(({ name, email, password, acceptTerms }) =>
          register.mutate({ name, email, password, acceptTerms }),
        )}
      >
        <div className="flex items-center gap-3 rounded-xl border border-accent/30 bg-[linear-gradient(90deg,hsl(var(--accent)/0.12),hsl(var(--accent-2)/0.08))] p-3.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent/15 text-accent">
            <Gift className="size-4" />
          </span>
          <div className="text-sm">
            <p className="font-semibold text-fg">Ganhe {SIGNUP_BONUS_CREDITS} créditos para experimentar</p>
            <p className="text-[13px] text-muted">
              Dá para cerca de {Math.floor(SIGNUP_BONUS_CREDITS / OPERATION_COSTS.fatura.max)} a{' '}
              {Math.floor(SIGNUP_BONUS_CREDITS / OPERATION_COSTS.fatura.min)} faturas. Sem cartão de crédito.
            </p>
          </div>
        </div>
        {register.isError && <Alert tone="danger" icon={<TriangleAlert />}>{userMessage(register.error)}</Alert>}
        <FormField label="Nome" error={errors.name?.message}>
          {(p) => <Input {...p} autoComplete="name" {...form.register('name')} />}
        </FormField>
        <FormField label="E-mail" error={errors.email?.message}>
          {(p) => <Input {...p} type="email" autoComplete="email" {...form.register('email')} />}
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Senha" error={errors.password?.message} hint="8+ caracteres, letras e números">
            {(p) => <PasswordInput {...p} autoComplete="new-password" {...form.register('password')} />}
          </FormField>
          <FormField label="Confirmar senha" error={errors.confirmPassword?.message}>
            {(p) => <PasswordInput {...p} autoComplete="new-password" {...form.register('confirmPassword')} />}
          </FormField>
        </div>
        <div>
          <Checkbox
            {...form.register('acceptTerms')}
            aria-invalid={!!errors.acceptTerms}
            label={
              <>
                Li e aceito os{' '}
                <Link to="/termos" className="text-accent hover:underline" target="_blank">
                  termos de uso
                </Link>{' '}
                e a{' '}
                <Link to="/privacidade" className="text-accent hover:underline" target="_blank">
                  política de privacidade
                </Link>
                .
              </>
            }
          />
          {errors.acceptTerms && (
            <p role="alert" className="mt-1.5 text-xs text-danger">
              {errors.acceptTerms.message}
            </p>
          )}
        </div>
        <Button type="submit" size="lg" loading={register.isPending}>
          Criar conta
        </Button>
      </form>
    </AuthShell>
  )
}

export function ForgotPasswordPage() {
  const forgot = useMutation({ mutationFn: (email: string) => authService.forgotPassword(email) })
  const form = useForm<z.infer<typeof forgotSchema>>({ resolver: zodResolver(forgotSchema), defaultValues: { email: '' } })
  return (
    <AuthShell
      title="Recuperar senha"
      subtitle="Enviaremos um link para você criar uma nova senha."
      footer={
        <Link to="/entrar" className="inline-flex items-center gap-1.5 hover:text-fg">
          <ArrowLeft className="size-3.5" /> Voltar para o login
        </Link>
      }
    >
      {forgot.isSuccess ? (
        <Alert tone="success" icon={<CheckCircle2 />} title="Verifique seu e-mail">
          Se houver uma conta com esse e-mail, você receberá o link em instantes.
          {config.useMocks && (
            <Link to="/redefinir-senha?token=demo" className="mt-2 block text-accent hover:underline">
              Abrir link de redefinição (demo)
            </Link>
          )}
        </Alert>
      ) : (
        <form noValidate className="flex flex-col gap-4" onSubmit={form.handleSubmit((v) => forgot.mutate(v.email))}>
          {forgot.isError && <Alert tone="danger" icon={<TriangleAlert />}>{userMessage(forgot.error)}</Alert>}
          <FormField label="E-mail" error={form.formState.errors.email?.message}>
            {(p) => <Input {...p} type="email" autoComplete="email" {...form.register('email')} />}
          </FormField>
          <Button type="submit" size="lg" loading={forgot.isPending}>
            Enviar link
          </Button>
        </form>
      )}
    </AuthShell>
  )
}

export function ResetPasswordPage() {
  const [params] = useSearchParams()
  const token = params.get('token')
  const navigate = useNavigate()
  const reset = useMutation({
    mutationFn: (password: string) => authService.resetPassword(token!, password),
    onSuccess: () => {
      toast.success('Senha redefinida', 'Entre com a nova senha.')
      navigate('/entrar')
    },
  })
  const form = useForm<z.infer<typeof resetSchema>>({ resolver: zodResolver(resetSchema), defaultValues: { password: '', confirmPassword: '' } })
  const { errors } = form.formState

  return (
    <AuthShell title="Nova senha" subtitle="Escolha uma senha que você não use em outros serviços.">
      {!token ? (
        <Alert tone="danger" icon={<TriangleAlert />} title="Link inválido">
          Este link não tem um token de redefinição.{' '}
          <Link to="/recuperar-senha" className="text-accent hover:underline">
            Peça um novo
          </Link>
          .
        </Alert>
      ) : (
        <form noValidate className="flex flex-col gap-4" onSubmit={form.handleSubmit((v) => reset.mutate(v.password))}>
          {reset.isError && <Alert tone="danger" icon={<TriangleAlert />}>{userMessage(reset.error)}</Alert>}
          <FormField label="Nova senha" error={errors.password?.message} hint="8+ caracteres, letras e números">
            {(p) => <PasswordInput {...p} autoComplete="new-password" {...form.register('password')} />}
          </FormField>
          <FormField label="Confirmar nova senha" error={errors.confirmPassword?.message}>
            {(p) => <PasswordInput {...p} autoComplete="new-password" {...form.register('confirmPassword')} />}
          </FormField>
          <Button type="submit" size="lg" loading={reset.isPending}>
            Redefinir senha
          </Button>
        </form>
      )}
    </AuthShell>
  )
}

export function VerifyEmailPage() {
  const [params] = useSearchParams()
  const token = params.get('token')
  const verify = useMutation({ mutationFn: (t: string) => authService.verifyEmail(t) })
  const started = useRef(false)
  useEffect(() => {
    if (token && !started.current) {
      started.current = true
      verify.mutate(token)
    }
  }, [token, verify])

  return (
    <AuthShell title="Verificação de e-mail">
      {!token ? (
        <Alert tone="danger" icon={<TriangleAlert />} title="Link inválido">
          O link de verificação está incompleto.
        </Alert>
      ) : verify.isError ? (
        <Alert tone="danger" icon={<TriangleAlert />} title="Não foi possível verificar">
          {userMessage(verify.error)}
        </Alert>
      ) : verify.isSuccess ? (
        <GlassCard className="flex flex-col items-center p-8 text-center">
          <CheckCircle2 className="size-8 text-success" />
          <p className="mt-4 font-medium text-fg">E-mail verificado</p>
          <ButtonLink to="/entrar" className="mt-6">
            Entrar
          </ButtonLink>
        </GlassCard>
      ) : (
        <p className="text-sm text-muted" role="status">
          Verificando…
        </p>
      )}
    </AuthShell>
  )
}

export function SessionExpiredPage() {
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from
  return (
    <AuthShell title="Sessão expirada" subtitle="Por segurança, entre novamente para continuar.">
      <GlassCard className="flex flex-col items-center p-8 text-center">
        <Clock className="size-8 text-warning" />
        <p className="mt-4 text-sm text-muted">
          Suas extrações em andamento continuam no servidor. O histórico deste navegador foi preservado.
        </p>
        <ButtonLink to="/entrar" state={{ from }} className="mt-6">
          Entrar novamente
        </ButtonLink>
      </GlassCard>
    </AuthShell>
  )
}
