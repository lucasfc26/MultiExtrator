import { usePreferences } from '@/stores/preferences'

const LOCALE = 'pt-BR'

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || Number.isNaN(bytes)) return '—'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let v = bytes / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toLocaleString(LOCALE, { maximumFractionDigits: 1 })} ${units[i]}`
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return '—'
  if (seconds < 60) return `${seconds.toLocaleString(LOCALE, { maximumFractionDigits: 1 })} s`
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return s ? `${m} min ${s} s` : `${m} min`
}

export function formatDate(iso: string | null | undefined, withTime = true): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const fmt = usePreferences.getState().dateFormat
  if (fmt === 'iso') {
    const p = (n: number) => String(n).padStart(2, '0')
    const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
    return withTime ? `${date} ${p(d.getHours())}:${p(d.getMinutes())}` : date
  }
  return d.toLocaleString(LOCALE, {
    day: '2-digit',
    month: fmt === 'long' ? 'short' : '2-digit',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  })
}

export function formatRelative(iso: string): string {
  const diff = (new Date(iso).getTime() - Date.now()) / 1000
  const rtf = new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto' })
  const abs = Math.abs(diff)
  if (abs < 60) return rtf.format(Math.round(diff), 'second')
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour')
  return rtf.format(Math.round(diff / 86400), 'day')
}

export function formatCurrency(cents: number, currency = 'BRL'): string {
  return (cents / 100).toLocaleString(LOCALE, { style: 'currency', currency })
}

export function formatNumber(n: number | null | undefined): string {
  return n == null ? '—' : n.toLocaleString(LOCALE)
}

export function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000)
}

export function maskDocumento(doc: string): string {
  const d = doc.replace(/\D/g, '')
  if (d.length === 11) return `***.${d.slice(3, 6)}.***-**`
  if (d.length === 14) return `**.${d.slice(2, 5)}.***/${d.slice(8, 12)}-**`
  return '***'
}
