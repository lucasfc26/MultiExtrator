import { useDropzone, type FileRejection } from 'react-dropzone'
import { FileImage, FileText, UploadCloud, X } from 'lucide-react'
import { ACCEPT_LABEL, EXTRACTOR_LIMITS } from '@/config/extractor'
import { formatBytes } from '@/lib/formatting'
import { cn } from '@/lib/utils/cn'

const REJECT_MSG: Record<string, string> = {
  'file-invalid-type': `formato não aceito (use ${ACCEPT_LABEL})`,
  'file-too-large': `maior que ${formatBytes(EXTRACTOR_LIMITS.maxFileBytes)}`,
  'too-many-files': `máximo de ${EXTRACTOR_LIMITS.maxFiles} arquivos por envio`,
}

export function rejectionMessages(rejections: FileRejection[]): string[] {
  return rejections.map((r) => `${r.file.name}: ${r.errors.map((e) => REJECT_MSG[e.code] ?? e.message).join(', ')}`)
}

export function FileDropzone({
  onFiles,
  onReject,
  disabled,
  remaining,
}: {
  onFiles: (files: File[]) => void
  onReject: (msgs: string[]) => void
  disabled?: boolean
  remaining: number
}) {
  const { getRootProps, getInputProps, isDragActive, isDragReject } = useDropzone({
    accept: EXTRACTOR_LIMITS.accept,
    maxSize: EXTRACTOR_LIMITS.maxFileBytes,
    maxFiles: remaining,
    disabled: disabled || remaining <= 0,
    onDrop: (accepted, rejected) => {
      if (accepted.length) onFiles(accepted)
      onReject(rejectionMessages(rejected))
    },
  })

  return (
    <div
      {...getRootProps()}
      className={cn(
        'group relative flex cursor-pointer flex-col items-center justify-center rounded-[var(--radius-card)] border-2 border-dashed px-6 py-12 text-center transition-colors duration-200',
        isDragReject
          ? 'border-danger/60 bg-danger/[0.05]'
          : isDragActive
            ? 'border-accent bg-accent/[0.06]'
            : 'border-line-strong bg-fg/[0.02] hover:border-accent/50 hover:bg-accent/[0.03]',
        (disabled || remaining <= 0) && 'pointer-events-none opacity-50',
      )}
    >
      <input {...getInputProps()} aria-label="Selecionar faturas" />
      <span
        className={cn(
          'grid size-14 place-items-center rounded-2xl border border-line-strong bg-surface text-accent transition-transform duration-300',
          isDragActive && 'scale-110',
        )}
      >
        <UploadCloud className="size-6" />
      </span>
      <p className="mt-4 text-[15px] font-medium text-fg">
        {isDragActive ? 'Solte para adicionar' : 'Arraste as faturas aqui ou clique para selecionar'}
      </p>
      <p className="mt-1 text-[13px] text-subtle">
        {ACCEPT_LABEL} · até {formatBytes(EXTRACTOR_LIMITS.maxFileBytes)} por arquivo · {EXTRACTOR_LIMITS.maxFiles} por envio
      </p>
    </div>
  )
}

export function FileList({ files, onRemove }: { files: File[]; onRemove: (index: number) => void }) {
  if (!files.length) return null
  return (
    <ul className="divide-y divide-line rounded-xl border border-line" aria-label="Arquivos selecionados">
      {files.map((f, i) => {
        const isPdf = f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
        const ext = f.name.split('.').pop()?.toUpperCase() ?? '—'
        return (
          <li key={`${f.name}-${f.size}-${i}`} className="flex items-center gap-3 px-4 py-3">
            <span className={cn('grid size-9 shrink-0 place-items-center rounded-lg', isPdf ? 'bg-danger/10 text-danger' : 'bg-info/10 text-info')}>
              {isPdf ? <FileText className="size-4" /> : <FileImage className="size-4" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-fg">{f.name}</p>
              <p className="text-xs text-subtle">
                {ext} · {formatBytes(f.size)}
              </p>
            </div>
            <button
              onClick={() => onRemove(i)}
              className="grid size-8 place-items-center rounded-lg text-subtle hover:bg-fg/[0.06] hover:text-fg"
              aria-label={`Remover ${f.name}`}
            >
              <X className="size-4" />
            </button>
          </li>
        )
      })}
    </ul>
  )
}
