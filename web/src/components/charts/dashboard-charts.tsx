import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

/** Carregado sob demanda (React.lazy): o Recharts não entra no bundle inicial. */

const axis = { stroke: 'hsl(var(--fg-subtle))', fontSize: 11, tickLine: false, axisLine: false } as const

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color?: string }[]; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="glass-strong rounded-lg px-3 py-2 text-xs">
      {label && <p className="mb-1 text-subtle">{label}</p>}
      {payload.map((p) => (
        <p key={p.name} className="flex items-center gap-2 text-fg">
          <span className="size-2 rounded-full" style={{ background: p.color }} />
          {p.name}: <b className="tabular-nums">{p.value}</b>
        </p>
      ))}
    </div>
  )
}

export function VolumeChart({ data }: { data: { dia: string; concluidas: number; falhas: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
        <defs>
          <linearGradient id="g-ok" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--accent))" stopOpacity={0.45} />
            <stop offset="100%" stopColor="hsl(var(--accent))" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="g-err" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--danger))" stopOpacity={0.3} />
            <stop offset="100%" stopColor="hsl(var(--danger))" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="hsl(var(--border))" vertical={false} />
        <XAxis dataKey="dia" {...axis} interval="preserveStartEnd" minTickGap={20} />
        <YAxis {...axis} allowDecimals={false} />
        <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'hsl(var(--border-strong))' }} />
        <Area animationDuration={350} type="monotone" dataKey="concluidas" name="Concluídas" stroke="hsl(var(--accent))" strokeWidth={2} fill="url(#g-ok)" />
        <Area animationDuration={350} type="monotone" dataKey="falhas" name="Falhas" stroke="hsl(var(--danger))" strokeWidth={2} fill="url(#g-err)" />
      </AreaChart>
    </ResponsiveContainer>
  )
}

export function CreditsChart({ data }: { data: { dia: string; creditos: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
        <defs>
          <linearGradient id="g-bar" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--accent-2))" />
            <stop offset="100%" stopColor="hsl(var(--accent-3))" />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="hsl(var(--border))" vertical={false} />
        <XAxis dataKey="dia" {...axis} />
        <YAxis {...axis} allowDecimals={false} />
        <Tooltip content={<ChartTooltip />} cursor={{ fill: 'hsl(var(--fg) / 0.04)' }} />
        <Bar animationDuration={350} dataKey="creditos" name="Créditos" fill="url(#g-bar)" radius={[6, 6, 0, 0]} maxBarSize={36} />
      </BarChart>
    </ResponsiveContainer>
  )
}

export function StatusChart({ data }: { data: { name: string; value: number; color: string }[] }) {
  const total = data.reduce((s, d) => s + d.value, 0)
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row xl:flex-col 2xl:flex-row">
      <div className="relative size-[160px] shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie animationDuration={350} data={data} dataKey="value" nameKey="name" innerRadius={52} outerRadius={76} paddingAngle={3} stroke="none">
              {data.map((d) => (
                <Cell key={d.name} fill={d.color} />
              ))}
            </Pie>
            <Tooltip content={<ChartTooltip />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div>
            <p className="text-2xl font-semibold text-fg tabular-nums">{total}</p>
            <p className="text-[11px] text-subtle">faturas</p>
          </div>
        </div>
      </div>
      <ul className="flex w-full flex-col gap-2 text-[13px]">
        {data.map((d) => (
          <li key={d.name} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-muted">
              <span className="size-2.5 rounded-full" style={{ background: d.color }} />
              {d.name}
            </span>
            <span className="font-medium text-fg tabular-nums">{d.value}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
