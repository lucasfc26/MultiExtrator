import { useForm, Controller, type Control, type FieldValues, type Path } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { FormField, Input, PasswordInput, SegmentedControl, Select } from '@/components/ui/form'
import {
  corporativoSchema,
  segundaViaSchema,
  siteEnelSchema,
  ultimos12Meses,
  type CorporativoForm,
  type SegundaViaForm,
  type SiteEnelForm,
} from '@/lib/validation/schemas'
import type { EntradaPorFluxo, Fluxo } from '@/types/engine'
import { cn } from '@/lib/utils/cn'

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

/** Meses que a ENEL disponibiliza (últimos 12). Selecionar vários = uma chamada. */
export function ReferencePicker({
  value,
  onChange,
  error,
}: {
  value: string[]
  onChange: (v: string[]) => void
  error?: string
}) {
  const meses = ultimos12Meses()
  const toggle = (m: string) => onChange(value.includes(m) ? value.filter((x) => x !== m) : [...value, m])
  return (
    <fieldset>
      <legend className="flex w-full items-baseline justify-between text-[13px] font-medium text-fg/90">
        Referências
        <span className="text-xs font-normal text-subtle">
          {value.length ? `${value.length} selecionada(s)` : 'nenhuma = mês atual'}
        </span>
      </legend>
      <div className="mt-2 grid grid-cols-4 gap-1.5 sm:grid-cols-6">
        {meses.map((m) => {
          const [mm, aaaa] = m.split('/')
          const on = value.includes(m)
          return (
            <button
              key={m}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(m)}
              className={cn(
                'rounded-lg border px-2 py-2 text-center text-[13px] transition-colors',
                on
                  ? 'border-accent/50 bg-accent/12 text-fg shadow-[inset_0_0_0_1px_hsl(var(--accent)/0.2)]'
                  : 'border-line text-muted hover:border-line-strong hover:text-fg',
              )}
            >
              <span className="font-medium capitalize">{MESES[Number(mm) - 1]}</span>
              <span className="block text-[11px] text-subtle">{aaaa}</span>
            </button>
          )
        })}
      </div>
      {error && (
        <p role="alert" className="mt-1.5 text-xs text-danger">
          {error}
        </p>
      )}
    </fieldset>
  )
}

function RefsField<T extends FieldValues>({ control, error }: { control: Control<T>; error?: string }) {
  return (
    <Controller
      control={control}
      name={'referencias' as Path<T>}
      render={({ field }) => <ReferencePicker value={field.value} onChange={field.onChange} error={error} />}
    />
  )
}

function refsBody(refs: string[]) {
  return refs.length === 0 ? {} : refs.length === 1 ? { referencia: refs[0] } : { referencias: refs }
}

type Submit<F extends Fluxo> = (entrada: EntradaPorFluxo[F]) => void

export function SiteEnelFormView({ formId, onSubmit }: { formId: string; onSubmit: Submit<'site_enel'> }) {
  const mesAtual = ultimos12Meses()[0]
  const form = useForm<SiteEnelForm>({
    resolver: zodResolver(siteEnelSchema),
    defaultValues: { usuario: '', senha: '', uc: '', tipo_conta: 'empresa', referencias: [mesAtual] },
  })
  const { errors } = form.formState
  return (
    <form
      id={formId}
      noValidate
      className="flex flex-col gap-5"
      onSubmit={form.handleSubmit((v) =>
        onSubmit({
          usuario: v.usuario,
          senha: v.senha,
          tipo_conta: v.tipo_conta,
          ...(v.uc ? { uc: v.uc } : {}),
          ...refsBody(v.referencias),
        }),
      )}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Login da Enel" error={errors.usuario?.message}>
          {(p) => <Input {...p} autoComplete="off" placeholder="login@empresa.com" {...form.register('usuario')} />}
        </FormField>
        <FormField label="Senha" error={errors.senha?.message} hint="Usada só nesta busca; não fica no histórico.">
          {(p) => <PasswordInput {...p} autoComplete="off" {...form.register('senha')} />}
        </FormField>
        <FormField label="UC (nº do cliente)" optional error={errors.uc?.message} hint="Sem UC: a conta padrão do login.">
          {(p) => <Input {...p} inputMode="numeric" placeholder="12345678" {...form.register('uc')} />}
        </FormField>
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-fg/90">Tipo de conta</span>
          <Controller
            control={form.control}
            name="tipo_conta"
            render={({ field }) => (
              <SegmentedControl
                label="Tipo de conta"
                value={field.value}
                onChange={field.onChange}
                options={[
                  { value: 'empresa', label: 'Empresa' },
                  { value: 'residencial', label: 'Residencial' },
                ]}
                className="h-11 w-full [&>button]:flex-1"
              />
            )}
          />
        </div>
      </div>
      <RefsField control={form.control} error={errors.referencias?.message ?? errors.referencias?.root?.message} />
    </form>
  )
}

export function CorporativoFormView({ formId, onSubmit }: { formId: string; onSubmit: Submit<'corporativo'> }) {
  const form = useForm<CorporativoForm>({
    resolver: zodResolver(corporativoSchema),
    defaultValues: { usuario: '', senha: '', uc: '', referencias: [ultimos12Meses()[0]] },
  })
  const { errors } = form.formState
  return (
    <form
      id={formId}
      noValidate
      className="flex flex-col gap-5"
      onSubmit={form.handleSubmit((v) => onSubmit({ usuario: v.usuario, senha: v.senha, uc: v.uc, ...refsBody(v.referencias) }))}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Login da Agência Virtual" error={errors.usuario?.message}>
          {(p) => <Input {...p} autoComplete="off" {...form.register('usuario')} />}
        </FormField>
        <FormField label="Senha" error={errors.senha?.message} hint="Usada só nesta busca; não fica no histórico.">
          {(p) => <PasswordInput {...p} autoComplete="off" {...form.register('senha')} />}
        </FormField>
        <FormField label="UC (nº do cliente)" error={errors.uc?.message} hint="Precisa estar no agrupamento do login." className="sm:col-span-2">
          {(p) => <Input {...p} inputMode="numeric" placeholder="12345678" {...form.register('uc')} />}
        </FormField>
      </div>
      <RefsField control={form.control} error={errors.referencias?.message ?? errors.referencias?.root?.message} />
    </form>
  )
}

export function SegundaViaFormView({ formId, onSubmit }: { formId: string; onSubmit: Submit<'segunda_via'> }) {
  const form = useForm<SegundaViaForm>({
    resolver: zodResolver(segundaViaSchema),
    defaultValues: { uc: '', cpf_cnpj: '', email_segunda_via: '', canal: 'email', referencias: [ultimos12Meses()[0]] },
  })
  const { errors } = form.formState
  return (
    <form
      id={formId}
      noValidate
      className="flex flex-col gap-5"
      onSubmit={form.handleSubmit((v) =>
        onSubmit({
          uc: v.uc,
          cpf_cnpj: v.cpf_cnpj,
          canal: v.canal,
          ...(v.email_segunda_via ? { email_segunda_via: v.email_segunda_via } : {}),
          ...refsBody(v.referencias),
        }),
      )}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="UC (nº do cliente)" error={errors.uc?.message}>
          {(p) => <Input {...p} inputMode="numeric" placeholder="12345678" {...form.register('uc')} />}
        </FormField>
        <FormField label="CPF/CNPJ do titular" error={errors.cpf_cnpj?.message} hint="Com ou sem pontuação.">
          {(p) => <Input {...p} inputMode="numeric" autoComplete="off" {...form.register('cpf_cnpj')} />}
        </FormField>
        <FormField
          label="E-mail que recebe o código"
          optional
          error={errors.email_segunda_via?.message}
          hint="A ENEL mostra os e-mails mascarados; este escolhe o certo."
        >
          {(p) => <Input {...p} type="email" placeholder="financeiro@cliente.com.br" {...form.register('email_segunda_via')} />}
        </FormField>
        <FormField label="Canal do código">
          {(p) => (
            <Select {...p} {...form.register('canal')}>
              <option value="email">E-mail</option>
              <option value="telefone">Telefone (SMS)</option>
            </Select>
          )}
        </FormField>
      </div>
      <RefsField control={form.control} error={errors.referencias?.message ?? errors.referencias?.root?.message} />
    </form>
  )
}
