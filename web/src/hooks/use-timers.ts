import { useEffect, useState } from 'react'

export function useDebounce<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

/** Segundos restantes até `iso` (atualiza a cada segundo). Troque a `key` do componente se `iso` mudar. */
export function useCountdown(iso: string | null): number | null {
  const calc = () => (iso ? Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 1000)) : null)
  const [left, setLeft] = useState(calc)
  useEffect(() => {
    if (!iso) return
    const t = setInterval(() => setLeft(calc()), 1000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iso])
  return left
}

/** Segundos desde `iso` (cronômetro). */
export function useElapsed(iso: string, running: boolean): number {
  const calc = () => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  const [s, setS] = useState(calc)
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => setS(calc()), 1000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iso, running])
  return s
}
