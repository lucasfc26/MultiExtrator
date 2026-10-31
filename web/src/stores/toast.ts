import { create } from 'zustand'

export type ToastTone = 'success' | 'error' | 'info' | 'warning'

export interface Toast {
  id: number
  tone: ToastTone
  title: string
  description?: string
}

interface ToastState {
  toasts: Toast[]
  push: (t: Omit<Toast, 'id'>) => void
  dismiss: (id: number) => void
}

let seq = 0

export const useToasts = create<ToastState>()((set) => ({
  toasts: [],
  push: (t) => {
    const id = ++seq
    set((s) => ({ toasts: [...s.toasts.slice(-3), { ...t, id }] }))
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), t.tone === 'error' ? 7000 : 4500)
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}))

export const toast = {
  success: (title: string, description?: string) => useToasts.getState().push({ tone: 'success', title, description }),
  error: (title: string, description?: string) => useToasts.getState().push({ tone: 'error', title, description }),
  info: (title: string, description?: string) => useToasts.getState().push({ tone: 'info', title, description }),
  warning: (title: string, description?: string) => useToasts.getState().push({ tone: 'warning', title, description }),
}
