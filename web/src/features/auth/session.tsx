import { useEffect, type ReactNode } from 'react'
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { qk } from '@/app/query-client'
import { setUnauthorizedHandler } from '@/lib/api/client'
import { authService } from '@/lib/api/services/auth.service'
import type { LoginInput, Session } from '@/types/platform'
import { PageLoader, ErrorState } from '@/components/feedback/feedback'
import { useUi } from '@/stores/ui'

export function useSession() {
  return useQuery<Session | null>({ queryKey: qk.session, queryFn: () => authService.me(), staleTime: 5 * 60_000 })
}

export function useLogin() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: LoginInput) => authService.login(input),
    onSuccess: (session) => {
      useUi.getState().setSessionExpired(false)
      qc.setQueryData(qk.session, session)
    },
  })
}

export function useLogout() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  return useMutation({
    mutationFn: () => authService.logout(),
    onSettled: () => {
      qc.setQueryData(qk.session, null)
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'session' && q.queryKey[0] !== 'history' })
      navigate('/entrar', { replace: true })
    },
  })
}

/** 401 de qualquer chamada → sessão expirada. */
export function AuthBridge({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  useEffect(() => {
    setUnauthorizedHandler(() => {
      if (qc.getQueryData(qk.session)) {
        useUi.getState().setSessionExpired(true)
        qc.setQueryData(qk.session, null)
      }
    })
    return () => setUnauthorizedHandler(null)
  }, [qc])
  return children
}

export function ProtectedRoute() {
  const { data, isPending, isError, error, refetch } = useSession()
  const expired = useUi((s) => s.sessionExpired)
  const location = useLocation()
  if (isPending) return <PageLoader />
  if (isError)
    return (
      <div className="grid min-h-dvh place-items-center">
        <ErrorState error={error} title="Não foi possível verificar sua sessão" onRetry={() => refetch()} />
      </div>
    )
  if (!data) {
    if (expired) return <Navigate to="/sessao-expirada" replace state={{ from: location.pathname }} />
    return <Navigate to="/entrar" replace state={{ from: location.pathname }} />
  }
  return <Outlet />
}

export function GuestRoute() {
  const { data, isPending } = useSession()
  if (isPending) return <PageLoader />
  if (data) return <Navigate to="/app" replace />
  return <Outlet />
}
