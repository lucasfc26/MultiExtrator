import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/** Preferências puramente visuais: ficam no navegador (não afetam a conta). */
export type Theme = 'dark' | 'light'
export type DateFormat = 'short' | 'long' | 'iso'

interface PreferencesState {
  theme: Theme
  dateFormat: DateFormat
  language: 'pt-BR'
  sidebarCollapsed: boolean
  compactTables: boolean
  setTheme: (t: Theme) => void
  toggleTheme: () => void
  setDateFormat: (f: DateFormat) => void
  setSidebarCollapsed: (v: boolean) => void
  setCompactTables: (v: boolean) => void
}

export function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark')
}

export const usePreferences = create<PreferencesState>()(
  persist(
    (set, get) => ({
      theme: 'dark',
      dateFormat: 'short',
      language: 'pt-BR',
      sidebarCollapsed: false,
      compactTables: false,
      setTheme: (theme) => {
        applyTheme(theme)
        set({ theme })
      },
      toggleTheme: () => get().setTheme(get().theme === 'dark' ? 'light' : 'dark'),
      setDateFormat: (dateFormat) => set({ dateFormat }),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      setCompactTables: (compactTables) => set({ compactTables }),
    }),
    {
      name: 'me-prefs',
      onRehydrateStorage: () => (state) => state && applyTheme(state.theme),
    },
  ),
)
