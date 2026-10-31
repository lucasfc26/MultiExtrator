import { beforeEach, describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LoginPage, RegisterPage } from '@/pages/public/auth-pages'
import { GuestRoute, ProtectedRoute } from '@/features/auth/session'
import { db, resetDemoDb, save } from '@/mocks/db'
import { renderRoutes } from './utils'

beforeEach(() => {
  localStorage.clear()
  resetDemoDb()
})

const routes = [
  { element: <GuestRoute />, children: [{ path: '/entrar', element: <LoginPage /> }, { path: '/cadastro', element: <RegisterPage /> }] },
  { path: '/app', element: <ProtectedRoute />, children: [{ index: true, element: <p>painel</p> }] },
]

describe('rotas protegidas', () => {
  it('sem sessão, /app redireciona para o login', async () => {
    const { router } = renderRoutes(routes, '/app')
    expect(await screen.findByRole('heading', { name: 'Entrar' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/entrar')
  })
})

describe('login', () => {
  it('valida os campos antes de chamar a API', async () => {
    renderRoutes(routes, '/entrar')
    await userEvent.click(await screen.findByRole('button', { name: 'Entrar' }))
    expect(await screen.findByText('Informe o e-mail.')).toBeInTheDocument()
    expect(screen.getByText('Informe a senha.')).toBeInTheDocument()
  })

  it('mostra o erro devolvido pela API', async () => {
    db().users.push({
      id: 'u1',
      name: 'Ana',
      email: 'ana@x.com',
      password: 'certa123',
      emailVerified: true,
      avatarUrl: null,
      createdAt: new Date().toISOString(),
      lastLoginAt: null,
    })
    save()
    renderRoutes(routes, '/entrar')
    await userEvent.type(await screen.findByLabelText('E-mail'), 'ana@x.com')
    await userEvent.type(screen.getByLabelText('Senha'), 'errada')
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }))
    expect(await screen.findByText('E-mail ou senha incorretos.')).toBeInTheDocument()
  })

  it('entra e vai para o painel', async () => {
    const { router } = renderRoutes(routes, '/entrar')
    await userEvent.type(await screen.findByLabelText('E-mail'), 'novo@x.com')
    await userEvent.type(screen.getByLabelText('Senha'), 'qualquer1')
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }))
    expect(await screen.findByText('painel')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/app')
  })

  it('permite visualizar a senha', async () => {
    renderRoutes(routes, '/entrar')
    const pwd = await screen.findByLabelText('Senha')
    expect(pwd).toHaveAttribute('type', 'password')
    await userEvent.click(screen.getByRole('button', { name: 'Mostrar senha' }))
    expect(pwd).toHaveAttribute('type', 'text')
  })
})

describe('cadastro', () => {
  it('exige senhas iguais e aceite dos termos', async () => {
    renderRoutes(routes, '/cadastro')
    await userEvent.type(await screen.findByLabelText('Nome'), 'Ana Lima')
    await userEvent.type(screen.getByLabelText('E-mail'), 'ana@x.com')
    await userEvent.type(screen.getByLabelText('Senha'), 'senha123')
    await userEvent.type(screen.getByLabelText('Confirmar senha'), 'senha124')
    await userEvent.click(screen.getByRole('button', { name: 'Criar conta' }))
    expect(await screen.findByText('As senhas não conferem.')).toBeInTheDocument()
    expect(screen.getByText(/É preciso aceitar os termos/)).toBeInTheDocument()
  })

  it('recusa senha fraca', async () => {
    renderRoutes(routes, '/cadastro')
    await userEvent.type(await screen.findByLabelText('Senha'), 'abc')
    await userEvent.click(screen.getByRole('button', { name: 'Criar conta' }))
    expect(await screen.findByText('Use pelo menos 8 caracteres.')).toBeInTheDocument()
  })

  it('cria a conta e pede a verificação do e-mail', async () => {
    renderRoutes(routes, '/cadastro')
    await userEvent.type(await screen.findByLabelText('Nome'), 'Ana Lima')
    await userEvent.type(screen.getByLabelText('E-mail'), 'ana@x.com')
    await userEvent.type(screen.getByLabelText('Senha'), 'senha123')
    await userEvent.type(screen.getByLabelText('Confirmar senha'), 'senha123')
    await userEvent.click(screen.getByRole('checkbox'))
    await userEvent.click(screen.getByRole('button', { name: 'Criar conta' }))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Confirme seu e-mail' })).toBeInTheDocument())
  })
})

describe('bônus de cadastro', () => {
  it('a conta nova recebe os créditos de boas-vindas', async () => {
    const { SIGNUP_BONUS_CREDITS } = await import('@/config/pricing')
    const antes = db().balance
    renderRoutes(routes, '/cadastro')
    expect(await screen.findByText(`Ganhe ${SIGNUP_BONUS_CREDITS} créditos para experimentar`)).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Nome'), 'Ana Lima')
    await userEvent.type(screen.getByLabelText('E-mail'), 'bonus@x.com')
    await userEvent.type(screen.getByLabelText('Senha'), 'senha123')
    await userEvent.type(screen.getByLabelText('Confirmar senha'), 'senha123')
    await userEvent.click(screen.getByRole('checkbox'))
    await userEvent.click(screen.getByRole('button', { name: 'Criar conta' }))
    expect(await screen.findByText(`${SIGNUP_BONUS_CREDITS} créditos de boas-vindas na sua conta`)).toBeInTheDocument()
    expect(db().balance).toBe(antes + SIGNUP_BONUS_CREDITS)
    expect(db().transactions.some((t) => t.reference === 'BONUS-CADASTRO')).toBe(true)
  })

  it('a faixa do bônus fecha e continua fechada', async () => {
    const { PublicLayout } = await import('@/components/layout/public-layout')
    const r = renderRoutes([{ element: <PublicLayout />, children: [{ path: '/', element: <p>home</p> }] }], '/')
    expect(screen.getByText(/para\s+experimentar/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Fechar aviso' }))
    expect(screen.queryByText(/para\s+experimentar/)).not.toBeInTheDocument()
    r.unmount()
    renderRoutes([{ element: <PublicLayout />, children: [{ path: '/', element: <p>home</p> }] }], '/')
    expect(screen.queryByText(/para\s+experimentar/)).not.toBeInTheDocument()
  })
})
