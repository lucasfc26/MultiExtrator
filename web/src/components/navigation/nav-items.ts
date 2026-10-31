import {
  BookOpen,
  Coins,
  FilePlus2,
  ScanText,
  History,
  KeyRound,
  LayoutDashboard,
  LifeBuoy,
  Bell,
  Settings,
  UserRound,
  type LucideIcon,
} from 'lucide-react'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  end?: boolean
}

export const NAV_SECTIONS: { title: string; items: NavItem[] }[] = [
  {
    title: 'Faturas',
    items: [
      { to: '/app', label: 'Visão geral', icon: LayoutDashboard, end: true },
      { to: '/app/nova-fatura', label: 'Nova fatura', icon: FilePlus2 },
      { to: '/app/extrator', label: 'Extrator', icon: ScanText },
      { to: '/app/historico', label: 'Histórico', icon: History },
    ],
  },
  {
    title: 'Conta',
    items: [
      { to: '/app/creditos', label: 'Créditos', icon: Coins },
      { to: '/app/api', label: 'API e integrações', icon: KeyRound },
      { to: '/app/docs', label: 'Documentação', icon: BookOpen },
      { to: '/app/notificacoes', label: 'Notificações', icon: Bell },
    ],
  },
  {
    title: 'Preferências',
    items: [
      { to: '/app/perfil', label: 'Perfil', icon: UserRound },
      { to: '/app/configuracoes', label: 'Configurações', icon: Settings },
      { to: '/app/ajuda', label: 'Ajuda e suporte', icon: LifeBuoy },
    ],
  },
]

export const ROUTE_TITLES: Record<string, string> = Object.fromEntries(
  NAV_SECTIONS.flatMap((s) => s.items.map((i) => [i.to, i.label])),
)
