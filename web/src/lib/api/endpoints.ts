/**
 * Endpoints ESPERADOS do backend NestJS (provisórios — o backend ainda não
 * existe). Ajuste aos contratos reais quando a OpenAPI estiver disponível.
 * Os endpoints do motor de extração real ficam em lib/engine.
 */
export const endpoints = {
  auth: {
    me: '/auth/me',
    login: '/auth/login',
    logout: '/auth/logout',
    register: '/auth/register',
    forgot: '/auth/password/forgot',
    reset: '/auth/password/reset',
    verifyEmail: '/auth/email/verify',
    resendVerification: '/auth/email/resend',
  },
  users: {
    me: '/users/me',
    password: '/users/me/password',
    sessions: '/users/me/sessions',
    exportData: '/users/me/export',
    deletion: '/users/me/deletion-request',
  },
  credits: {
    balance: '/credits/balance',
    transactions: '/credits/transactions',
    packages: '/credits/packages',
  },
  payments: {
    orders: '/payments/orders',
    order: (id: string) => `/payments/orders/${id}`,
  },
  apiKeys: {
    list: '/api-keys',
    revoke: (id: string) => `/api-keys/${id}/revoke`,
  },
  notifications: {
    list: '/notifications',
    read: (id: string) => `/notifications/${id}/read`,
    readAll: '/notifications/read-all',
    preferences: '/notifications/preferences',
  },
  settings: '/settings',
} as const
