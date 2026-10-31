import { useState, type CSSProperties, type ReactNode } from 'react'
import { CopyButton } from '@/components/ui/misc'
import { cn } from '@/lib/utils/cn'

export interface CodeSample {
  lang: 'typescript' | 'python' | 'bash' | 'json'
  label: string
  code: string
}

/** Realce leve (sem biblioteca), com as cores de código da referência. */
function highlight(code: string, lang: CodeSample['lang']): ReactNode[] {
  const comment = lang === 'typescript' ? /\/\/[^\n]*/y : lang === 'json' ? /(?!)/y : /(?<=^|\s)#[^\n]*/my
  const keyword =
    lang === 'bash'
      ? /\bcurl\b|(?<=\s)-{1,2}[A-Za-z-]+/y
      : /\b(?:const|let|await|async|import|from|return|def|with|as|if|else|for|while|in|true|false|null|None|True|False|new|print|continue)\b/y
  const rules: [RegExp, string][] = [
    [comment, 'text-code-muted italic'],
    [/"(?:[^"\\\n]|\\.)*"(?=\s*:)/y, 'text-code-key'],
    [/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/y, 'text-code-string'],
    [/\b\d+(?:[._]\d+)*\b/y, 'text-code-number'],
    [keyword, 'text-code-keyword'],
    [/[{}[\](),:;]/y, 'text-code-muted'],
  ]
  const out: ReactNode[] = []
  let i = 0
  let buf = ''
  while (i < code.length) {
    let matched = false
    for (const [re, cls] of rules) {
      re.lastIndex = i
      const m = re.exec(code)
      if (m && m.index === i && m[0].length) {
        if (buf) out.push(buf)
        buf = ''
        out.push(
          <span key={i} className={cls}>
            {m[0]}
          </span>,
        )
        i += m[0].length
        matched = true
        break
      }
    }
    if (!matched) buf += code[i++]
  }
  if (buf) out.push(buf)
  return out
}

/**
 * Bloco de código com abas por linguagem. No desktop mantém a mesma altura em
 * todas as abas (sem "pulo" do layout ao lado); rola na horizontal dentro do
 * próprio bloco, sem alargar o container.
 */
export function CodeBlock({
  samples,
  className,
  title,
}: {
  samples: CodeSample[]
  className?: string
  title?: ReactNode
}) {
  const [active, setActive] = useState(0)
  const s = samples[active]
  const maxLines = Math.max(...samples.map((x) => x.code.split('\n').length))

  return (
    <div
      className={cn(
        'w-full max-w-full min-w-0 overflow-hidden rounded-[var(--radius-card)] border border-code-line bg-code-bg text-code-fg shadow-[var(--shadow-lift)]',
        className,
      )}
    >
      <div className="flex items-center gap-2 border-b border-code-line px-2 py-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto" role="tablist" aria-label="Linguagem">
          {samples.map((x, i) => (
            <button
              key={x.label}
              role="tab"
              aria-selected={i === active}
              onClick={() => setActive(i)}
              className={cn(
                'shrink-0 rounded-md px-2.5 py-1 font-mono text-xs font-medium transition-colors',
                i === active
                  ? 'bg-white/10 text-white shadow-[inset_0_-2px_0_hsl(var(--code-number))]'
                  : 'text-code-muted hover:text-white',
              )}
            >
              {x.label}
            </button>
          ))}
        </div>
        <CopyButton value={s.code} className="shrink-0 text-code-muted hover:bg-white/10 hover:text-white" />
      </div>
      {title && (
        <div className="truncate border-b border-code-line px-4 py-2 font-mono text-[11.5px] text-code-muted">{title}</div>
      )}
      <pre
        role="tabpanel"
        className="overflow-x-auto p-4 font-mono text-[12.5px] leading-[1.7] whitespace-pre lg:min-h-[var(--code-min-h)]"
        style={{ '--code-min-h': `calc(${maxLines} * 1.7em + 2rem)` } as CSSProperties}
      >
        <code>{highlight(s.code, s.lang)}</code>
      </pre>
    </div>
  )
}
