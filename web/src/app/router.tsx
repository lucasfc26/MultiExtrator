import { lazy, Suspense, type ComponentType, type ReactNode } from 'react'
import { createBrowserRouter, Navigate, Outlet, type RouteObject } from 'react-router-dom'
import { PublicLayout } from '@/components/layout/public-layout'
import { AppLayout } from '@/components/layout/app-layout'
import { PageLoader } from '@/components/feedback/feedback'
import { GuestRoute, ProtectedRoute } from '@/features/auth/session'
import { ScrollManager } from './scroll-manager'
import { loaders } from './route-loaders'

/** React.lazy para exports nomeados: cada página vira um chunk próprio. */
function page<M extends Record<string, unknown>>(loader: () => Promise<M>, name: keyof M) {
  return lazy(() => loader().then((m) => ({ default: m[name] as ComponentType })))
}

const L = loaders
const Landing = page(L.landing, 'default')
const Login = page(L.auth, 'LoginPage')
const Register = page(L.auth, 'RegisterPage')
const Forgot = page(L.auth, 'ForgotPasswordPage')
const Reset = page(L.auth, 'ResetPasswordPage')
const Verify = page(L.auth, 'VerifyEmailPage')
const Expired = page(L.auth, 'SessionExpiredPage')
const Terms = page(L.institutional, 'TermsPage')
const Privacy = page(L.institutional, 'PrivacyPage')
const Retention = page(L.institutional, 'RetentionPage')
const Support = page(L.institutional, 'SupportPage')
const Contact = page(L.institutional, 'ContactPage')
const Help = page(L.statics, 'HelpPage')
const NotFound = page(L.statics, 'NotFoundPage')
const ApiDocs = lazy(L.apiDocs)

const Dashboard = page(L.dashboard, 'default')
const NewExtraction = page(L.newExtraction, 'default')
const Extractor = page(L.extractor, 'default')
const History = page(L.history, 'HistoryPage')
const Detail = page(L.history, 'ExtractionDetailPage')
const Credits = page(L.credits, 'CreditsPage')
const Checkout = page(L.credits, 'CheckoutPage')
const Payment = page(L.credits, 'PaymentStatusPage')
const ApiKeys = page(L.apiKeys, 'default')
const Notifications = page(L.notifications, 'default')
const Profile = page(L.account, 'ProfilePage')
const Settings = page(L.account, 'SettingsPage')

const s = (el: ReactNode) => <Suspense fallback={<PageLoader />}>{el}</Suspense>

function Root() {
  return (
    <>
      <ScrollManager />
      <Outlet />
    </>
  )
}

export const routes: RouteObject[] = [
  {
    element: <Root />,
    children: [
      {
        element: <PublicLayout />,
        children: [
          { path: '/', element: s(<Landing />) },
          { path: '/docs', element: s(<ApiDocs />) },
          { path: '/termos', element: s(<Terms />) },
          { path: '/privacidade', element: s(<Privacy />) },
          { path: '/retencao', element: s(<Retention />) },
          { path: '/suporte', element: s(<Support />) },
          { path: '/contato', element: s(<Contact />) },
          { path: '*', element: s(<NotFound />) },
        ],
      },
      {
        element: <GuestRoute />,
        children: [
          { path: '/entrar', element: s(<Login />) },
          { path: '/cadastro', element: s(<Register />) },
          { path: '/recuperar-senha', element: s(<Forgot />) },
        ],
      },
      { path: '/redefinir-senha', element: s(<Reset />) },
      { path: '/verificar-email', element: s(<Verify />) },
      { path: '/sessao-expirada', element: s(<Expired />) },
      {
        path: '/app',
        element: <ProtectedRoute />,
        children: [
          {
            element: <AppLayout />,
            children: [
              { index: true, element: <Dashboard /> },
              { path: 'nova-fatura', element: <NewExtraction /> },
              { path: 'nova-extracao', element: <Navigate to="/app/nova-fatura" replace /> },
              { path: 'extrator', element: <Extractor /> },
              { path: 'historico', element: <History /> },
              { path: 'historico/:id', element: <Detail /> },
              { path: 'creditos', element: <Credits /> },
              { path: 'creditos/comprar/:packageId', element: <Checkout /> },
              { path: 'creditos/pagamento/:id', element: <Payment /> },
              { path: 'api', element: <ApiKeys /> },
              { path: 'docs', element: <ApiDocs embedded /> },
              { path: 'notificacoes', element: <Notifications /> },
              { path: 'perfil', element: <Profile /> },
              { path: 'configuracoes', element: <Settings /> },
              { path: 'ajuda', element: <Help /> },
              { path: '*', element: <Navigate to="/app" replace /> },
            ],
          },
        ],
      },
    ],
  },
]

export const createRouter = () => createBrowserRouter(routes)
