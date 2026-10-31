import { create } from 'zustand'

/** Estado efêmero de interface (não persistido). */
interface UiState {
  mobileNavOpen: boolean
  setMobileNavOpen: (v: boolean) => void
  sessionExpired: boolean
  setSessionExpired: (v: boolean) => void
}

export const useUi = create<UiState>()((set) => ({
  mobileNavOpen: false,
  setMobileNavOpen: (mobileNavOpen) => set({ mobileNavOpen }),
  sessionExpired: false,
  setSessionExpired: (sessionExpired) => set({ sessionExpired }),
}))
