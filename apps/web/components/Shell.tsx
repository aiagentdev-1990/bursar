'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { useState, type ReactNode } from 'react'
import { HireAgentModal } from './HireAgentModal'
import { ORG_NAME } from '@/lib/mock-data'

const NAV = [
  { href: '/', label: 'Roster' },
  { href: '/activity', label: 'Activity' },
  { href: '/settings', label: 'Settings' },
] as const

/** Header + nav, present on every screen. Owns the hire modal, which opens over whatever
 *  screen you're on — the mockup shows it over the overview, but the trigger is in the shell. */
export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const [hiring, setHiring] = useState(false)

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' || pathname.startsWith('/pending') : pathname.startsWith(href)

  return (
    <>
      <header className="header">
        <div className="brand">
          <span className="brand-mark" aria-hidden />
          <span className="brand-name">Roster</span>
          <span className="brand-org">{ORG_NAME}</span>
        </div>

        <div className="header-right">
          <nav className="nav">
            {NAV.map((item) => (
              <Link key={item.href} href={item.href} data-active={isActive(item.href)}>
                {item.label}
              </Link>
            ))}
          </nav>
          <button type="button" className="btn btn-outline" onClick={() => setHiring(true)}>
            + Hire an agent
          </button>
        </div>
      </header>

      <main className="main">{children}</main>

      {hiring && <HireAgentModal onClose={() => setHiring(false)} />}
    </>
  )
}
