import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import type { z } from 'zod'
import { KeyRound, RefreshCw, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FormField, Input } from '@/components/ui/form'
import { Alert } from '@/components/ui/misc'
import { useCountdown } from '@/hooks/use-timers'
import { userMessage } from '@/lib/api/errors'
import { codigoSchema } from '@/lib/validation/schemas'
import type { ExtractionRecord } from '@/types/extraction'
import { sendCode } from './runner'

/** Etapa 2 da 2 VIA: o código que a ENEL enviou ao cliente. */
export function CodeEntry({ record }: { record: ExtractionRecord }) {
  const left = useCountdown(record.expiraCodigoEm)
  const form = useForm<z.infer<typeof codigoSchema>>({ resolver: zodResolver(codigoSchema), defaultValues: { codigo: '' } })
  const send = useMutation({
    mutationFn: (body: { codigo?: string; reenviar?: boolean }) => sendCode(record.id, body),
    onSuccess: () => form.reset(),
  })
  const mm = left != null ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : null

  return (
    <div className="rounded-xl border border-accent-3/30 bg-accent-3/[0.06] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent-3/15 text-accent-3">
            <KeyRound className="size-4" />
          </span>
          <div>
            <p className="text-sm font-semibold text-fg">Código de segurança</p>
            <p className="mt-0.5 text-[13px] text-muted">{record.observacao}</p>
          </div>
        </div>
        {mm && (
          <span
            className={`rounded-lg border px-2.5 py-1 font-mono text-sm tabular-nums ${left! < 60 ? 'border-danger/30 text-danger' : 'border-line-strong text-fg'}`}
            aria-label={`Tempo restante: ${mm}`}
          >
            {mm}
          </span>
        )}
      </div>

      <form
        noValidate
        className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-start"
        onSubmit={form.handleSubmit((v) => send.mutate({ codigo: v.codigo.replace(/\s/g, '') }))}
      >
        <FormField label="Código recebido pelo cliente" error={form.formState.errors.codigo?.message} className="flex-1">
          {(p) => (
            <Input
              {...p}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              className="font-mono tracking-[0.3em]"
              {...form.register('codigo')}
            />
          )}
        </FormField>
        <div className="flex gap-2 sm:mt-[26px]">
          <Button type="submit" loading={send.isPending && !send.variables?.reenviar}>
            Enviar código
          </Button>
          <Button
            variant="secondary"
            icon={<RefreshCw className="size-3.5" />}
            loading={send.isPending && !!send.variables?.reenviar}
            disabled={send.isPending}
            onClick={() => send.mutate({ reenviar: true })}
            title="O código não chegou: pedir outro à ENEL"
          >
            Reenviar
          </Button>
        </div>
      </form>
      {send.isError && (
        <Alert tone="danger" icon={<TriangleAlert />} className="mt-3">
          {userMessage(send.error)}
        </Alert>
      )}
      {left === 0 && (
        <p className="mt-3 text-[13px] text-danger">
          O prazo acabou. O motor cancela a extração; comece uma nova se precisar.
        </p>
      )}
    </div>
  )
}
