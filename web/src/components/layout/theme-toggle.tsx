import { Moon, Sun } from 'lucide-react'
import { usePreferences } from '@/stores/preferences'
import { Button } from '@/components/ui/button'

export function ThemeToggle({ className }: { className?: string }) {
  const theme = usePreferences((s) => s.theme)
  const toggle = usePreferences((s) => s.toggleTheme)
  const next = theme === 'dark' ? 'claro' : 'escuro'
  return (
    <Button variant="ghost" size="icon" className={className} onClick={toggle} aria-label={`Ativar tema ${next}`} title={`Tema ${next}`}>
      {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  )
}
