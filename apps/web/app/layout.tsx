import type { Metadata } from 'next'
import { Shell } from '@/components/Shell'
import './globals.css'

export const metadata: Metadata = {
  title: 'Roster',
  description: 'Give every AI agent on your team a role and spending limits, enforced by a contract.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  )
}
