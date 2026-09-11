'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/** Re-renders the server page every few seconds while `active`, so a hire's progress row moves on
 *  its own. Stops as soon as there is nothing left to wait for. */
export function AutoRefresh({ active, everyMs = 4000 }: { active: boolean; everyMs?: number }) {
  const router = useRouter()

  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => router.refresh(), everyMs)
    return () => clearInterval(timer)
  }, [active, everyMs, router])

  return null
}
