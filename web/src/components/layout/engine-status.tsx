import { config } from '@/lib/config'
import { ENGINE_LABEL } from '@/lib/engine'
import { useEngineHealth } from '@/features/queries'
import { cn } from '@/lib/utils/cn'

/** Mostra a qual motor o frontend está ligado e se ele responde. */
export function EngineStatusPill({ className }: { className?: string }) {
  const { data, isPending } = useEngineHealth()
  const online = data?.online
  return (
    <div
      className={cn('rounded-xl border border-line bg-fg/[0.03] px-3 py-2.5', className)}
      title={data?.detalhe}
      role="status"
    >
      <div className="flex items-center gap-2 text-[12px] font-medium text-fg">
        <span
          className={cn(
            'size-2 rounded-full',
            isPending ? 'bg-subtle' : online ? 'bg-success shadow-[0_0_10px_hsl(var(--success))]' : 'bg-danger',
          )}
        />
        Motor: {ENGINE_LABEL[config.engine]}
      </div>
      <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-subtle">
        {isPending ? 'Verificando…' : data?.detalhe}
      </p>
    </div>
  )
}
