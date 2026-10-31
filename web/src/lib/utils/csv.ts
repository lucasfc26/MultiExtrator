type Cell = string | number | boolean | null | undefined

function escape(v: Cell): string {
  if (v === null || v === undefined) return ''
  const s = String(v)
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** CSV com ";" (padrão do Excel em pt-BR) e BOM para acentuação correta. */
export function toCsv(rows: Record<string, Cell>[], columns?: string[]): string {
  const cols = columns ?? Array.from(new Set(rows.flatMap((r) => Object.keys(r))))
  const lines = [cols.map(escape).join(';'), ...rows.map((r) => cols.map((c) => escape(r[c])).join(';'))]
  return '﻿' + lines.join('\r\n')
}
