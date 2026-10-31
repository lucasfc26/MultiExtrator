import { useMemo, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { CopyButton } from '@/components/ui/misc'

/** Visualizador JSON em árvore (carregado sob demanda). */
function Node({ name, value, depth }: { name?: string; value: unknown; depth: number }) {
  const [open, setOpen] = useState(depth < 2)
  const isObj = value !== null && typeof value === 'object'
  const key = name !== undefined && <span className="text-code-key">"{name}"</span>

  if (!isObj) {
    const cls =
      typeof value === 'string'
        ? 'text-code-string'
        : typeof value === 'number'
          ? 'text-code-number'
          : 'text-code-keyword'
    return (
      <div className="pl-5">
        {key}
        {key && <span className="text-code-muted">: </span>}
        <span className={cn(cls, 'break-all')}>{JSON.stringify(value)}</span>
      </div>
    )
  }

  const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v] as const) : Object.entries(value)
  const [o, c] = Array.isArray(value) ? ['[', ']'] : ['{', '}']
  return (
    <div className="pl-1">
      <button
        type="button"
        onClick={() => setOpen((x) => !x)}
        className="inline-flex items-center gap-0.5 rounded hover:bg-white/[0.06]"
        aria-expanded={open}
      >
        <ChevronRight className={cn('size-3.5 text-code-muted transition-transform', open && 'rotate-90')} />
        {key}
        {key && <span className="text-code-muted">: </span>}
        <span className="text-code-muted">{o}</span>
        {!open && <span className="text-code-muted"> {entries.length} … {c}</span>}
      </button>
      {open && (
        <>
          <div className="border-l border-code-line pl-2">
            {entries.map(([k, v]) => (
              <Node key={k} name={Array.isArray(value) ? undefined : k} value={v} depth={depth + 1} />
            ))}
          </div>
          <div className="pl-5 text-code-muted">{c}</div>
        </>
      )}
    </div>
  )
}

export default function JsonViewer({ data, className }: { data: unknown; className?: string }) {
  const text = useMemo(() => JSON.stringify(data, null, 2), [data])
  return (
    <div className={cn('relative rounded-xl border border-code-line bg-code-bg text-code-fg', className)}>
      <div className="absolute top-2 right-2">
        <CopyButton value={text} label="Copiar JSON" className="text-code-muted hover:bg-white/10 hover:text-white" />
      </div>
      <div className="max-h-[480px] overflow-auto p-4 pr-28 font-mono text-[12.5px] leading-relaxed">
        <Node value={data} depth={0} />
      </div>
    </div>
  )
}
