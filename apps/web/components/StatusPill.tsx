import type { AgentStatus, PaymentStatus } from '@/lib/roster'

const AGENT_LABEL: Record<AgentStatus, string> = {
  active: 'Active',
  'needs-review': 'Needs review',
  revoked: 'Revoked',
}

const PAYMENT_LABEL: Record<PaymentStatus, string> = {
  settled: 'Settled',
  held: 'Held · review',
  rejected: 'Rejected',
}

/** Accent outline means "this is waiting on the owner". Everything else is a grey fill.
 *  Nothing else in the UI is coloured — see docs/mockups/README.md. */
function pillClass(attention: boolean, quiet: boolean): string {
  if (attention) return 'pill pill-attention'
  if (quiet) return 'pill pill-quiet'
  return 'pill pill-settled'
}

export function AgentStatusPill({ status }: { status: AgentStatus }) {
  return (
    <span className={pillClass(status === 'needs-review', status === 'revoked')}>
      {AGENT_LABEL[status]}
    </span>
  )
}

export function PaymentStatusPill({ status }: { status: PaymentStatus }) {
  return (
    <span className={pillClass(status === 'held', status === 'rejected')}>
      {PAYMENT_LABEL[status]}
    </span>
  )
}
