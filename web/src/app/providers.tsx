import { useEffect, type ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { MotionConfig } from 'motion/react'
import { queryClient } from './query-client'
import { AuthBridge } from '@/features/auth/session'
import { Toaster } from '@/components/feedback/feedback'
import { resumePending } from '@/features/extractions/runner'

export function Providers({ children }: { children: ReactNode }) {
  useEffect(() => {
    void resumePending()
  }, [])
  return (
    <QueryClientProvider client={queryClient}>
      <MotionConfig reducedMotion="user">
        <AuthBridge>{children}</AuthBridge>
        <Toaster />
      </MotionConfig>
    </QueryClientProvider>
  )
}
