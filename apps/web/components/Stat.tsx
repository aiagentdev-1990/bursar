import type { ReactNode } from 'react'

export function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="stat">
      <span className="eyebrow">{label}</span>
      <span className="stat-value">{children}</span>
    </div>
  )
}

export function StatRow({ children }: { children: ReactNode }) {
  return <div className="stats">{children}</div>
}
