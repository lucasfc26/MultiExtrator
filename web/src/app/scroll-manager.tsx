import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

/** Topo da página ao trocar de rota; âncoras (#secao) rolam até a seção. */
export function ScrollManager() {
  const { pathname, hash } = useLocation()
  useEffect(() => {
    if (hash) {
      const t = setTimeout(() => document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: 'smooth' }), 80)
      return () => clearTimeout(t)
    }
    window.scrollTo({ top: 0 })
  }, [pathname, hash])
  return null
}
