// Checkpoint 8 fixture data. The layout is the deliverable at this checkpoint; checkpoint 9
// replaces this module with Blockscout event data (TECH-DESIGN.md §4.5) without the components
// changing shape. The types below are therefore written as the shape a Blockscout-derived
// selector would return, not as whatever was convenient for the markup.
//
// Figures follow DECISIONS.md 2026-09-09: mockup names, mockup cap figures, five agents.
// Scout and Ledger exist so the mockups' derived totals balance exactly:
//   committed  = sum(perPeriodCap) = $2,250
//   spend      = sum(periodSpend)  = $1,526.00
//   unspent    = committed - spend = $724

import { parseUsd } from './money'
import { categoryForRole, type Category } from './categories'

function usdc(v: string): bigint {
  const parsed = parseUsd(v)
  if (parsed === null) throw new Error(`mock-data: bad amount ${v}`)
  return parsed
}

/** The mockups are dated 8 September 2026. Group headers key off this, not the wall clock, so
 *  the screens keep matching the reference images. Checkpoint 9 swaps it for `new Date()`. */
export const DEMO_TODAY = '2026-09-08'

export type AgentStatus = 'active' | 'needs-review' | 'revoked'

export interface Agent {
  /** Backend id. The owner never sees a wallet address or an agent id (§4.1) — this is a routing
   *  key only, and never rendered. */
  id: string
  /** Backend-owned: the contract has no `name` field. See the open item in DECISIONS.md. */
  name: string
  role: string
  perTxCap: bigint
  perPeriodCap: bigint
  periodSpend: bigint
  status: AgentStatus
  /** Pre-rendered at this checkpoint; computed from block timestamps at checkpoint 9. */
  lastActivity: string
  /** Sparkline series, oldest first. Unitless — shape only. */
  trend: number[]
}

export const agents: Agent[] = [
  {
    id: 'pricer',
    name: 'Pricer',
    role: 'Comparable-listing research',
    perTxCap: usdc('10'),
    perPeriodCap: usdc('400'),
    periodSpend: usdc('268'),
    status: 'active',
    lastActivity: '6 minutes ago',
    trend: [3, 5, 4, 6, 5, 8, 6, 9, 7, 10, 8, 11],
  },
  {
    id: 'concierge',
    name: 'Concierge',
    role: 'Buyer questions and offers',
    perTxCap: usdc('25'),
    perPeriodCap: usdc('150'),
    periodSpend: usdc('41'),
    status: 'active',
    lastActivity: '2 minutes ago',
    trend: [2, 3, 2, 4, 3, 3, 5, 4, 6, 5, 7, 6],
  },
  {
    id: 'runner',
    name: 'Runner',
    role: 'One-off task payouts',
    perTxCap: usdc('75'),
    perPeriodCap: usdc('900'),
    periodSpend: usdc('612'),
    status: 'needs-review',
    lastActivity: '18 minutes ago',
    trend: [4, 6, 5, 9, 7, 12, 9, 14, 11, 16, 13, 18],
  },
  {
    id: 'scout',
    name: 'Scout',
    role: 'Auction and estate sourcing',
    perTxCap: usdc('50'),
    perPeriodCap: usdc('500'),
    periodSpend: usdc('340'),
    status: 'active',
    lastActivity: '1 hour ago',
    trend: [6, 5, 7, 6, 8, 7, 9, 8, 10, 9, 11, 10],
  },
  {
    id: 'ledger',
    name: 'Ledger',
    role: 'Bookkeeping and reconciliation',
    perTxCap: usdc('40'),
    perPeriodCap: usdc('300'),
    periodSpend: usdc('265'),
    status: 'active',
    lastActivity: '4 hours ago',
    trend: [5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11],
  },
]

export function agentCategory(agent: Agent): Category {
  return categoryForRole(agent.role)
}

export function findAgent(id: string): Agent | undefined {
  return agents.find((a) => a.id === id)
}

// ─── pending requests (§4.3) ──────────────────────────────────────────────────

export interface PendingRequest {
  requestId: string
  agentId: string
  /** Transaction-level category — a property of the payment, not of the agent. */
  category: string
  payee: string
  /** Full prose, not a memo field. The mockup renders this as a sentence. */
  purpose: string
  amount: bigint
  requestedAt: string
}

export const pendingRequests: PendingRequest[] = [
  {
    requestId: '1',
    agentId: 'runner',
    category: 'Authentication',
    payee: 'Verity Watch Authentication',
    purpose:
      'Pre-purchase authentication on an Omega Speedmaster ref. 145.022 — movement inspection and case verification before the seller is paid.',
    amount: usdc('120'),
    requestedAt: 'Today, 09:12',
  },
]

export function findPending(requestId: string): PendingRequest | undefined {
  return pendingRequests.find((r) => r.requestId === requestId)
}

// ─── activity log (§4.5) ──────────────────────────────────────────────────────

export type PaymentStatus = 'settled' | 'held' | 'rejected'

export interface Payment {
  id: string
  /** ISO date, used for day grouping. */
  day: string
  time: string
  agentId: string
  payee: string
  memo: string
  category: string
  amount: bigint
  status: PaymentStatus
}

export const payments: Payment[] = [
  // Today · 8 September — $58.40 settled
  { id: 'p1', day: '2026-09-08', time: '09:12', agentId: 'runner', payee: 'Verity Watch Authentication', memo: 'Pre-purchase authentication, Omega ref. 145.022', category: 'Authentication', amount: usdc('120'), status: 'held' },
  { id: 'p2', day: '2026-09-08', time: '08:58', agentId: 'pricer', payee: 'Chrono24 Data', memo: 'Comparable sold-listing pull', category: 'Data & research', amount: usdc('14'), status: 'settled' },
  { id: 'p3', day: '2026-09-08', time: '08:20', agentId: 'concierge', payee: 'Twilio', memo: 'Buyer SMS, 240 messages', category: 'Messaging', amount: usdc('6.40'), status: 'settled' },
  { id: 'p4', day: '2026-09-08', time: '07:05', agentId: 'scout', payee: 'Invaluable', memo: 'Auction alert feed, weekly', category: 'Sourcing', amount: usdc('38'), status: 'settled' },

  // Yesterday · 7 September — $106.00 settled
  { id: 'p5', day: '2026-09-07', time: '16:41', agentId: 'ledger', payee: 'Xero', memo: 'Monthly reconciliation run', category: 'Finance & admin', amount: usdc('75'), status: 'settled' },
  { id: 'p6', day: '2026-09-07', time: '11:03', agentId: 'pricer', payee: 'Exa', memo: 'Dealer inventory sweep, 3 sources', category: 'Data & research', amount: usdc('22'), status: 'settled' },
  { id: 'p7', day: '2026-09-07', time: '09:27', agentId: 'concierge', payee: 'Groq', memo: 'Offer-response drafting', category: 'Messaging', amount: usdc('9'), status: 'settled' },

  // 6 September — $277.00 settled, plus the rejected request
  { id: 'p8', day: '2026-09-06', time: '15:52', agentId: 'runner', payee: 'Bench Watchmaking Co.', memo: 'Service quote, Rolex 16610 bracelet', category: 'Authentication', amount: usdc('180'), status: 'settled' },
  { id: 'p9', day: '2026-09-06', time: '14:10', agentId: 'runner', payee: 'Halden Courier', memo: 'Insured overnight transit, declined — over cap', category: 'Contract work', amount: usdc('210'), status: 'rejected' },
  { id: 'p10', day: '2026-09-06', time: '12:35', agentId: 'ledger', payee: 'Stripe Tax', memo: 'Quarterly filing prep', category: 'Finance & admin', amount: usdc('42'), status: 'settled' },
  { id: 'p11', day: '2026-09-06', time: '10:18', agentId: 'scout', payee: 'Invaluable', memo: 'Estate lot watchlist, 12 lots', category: 'Sourcing', amount: usdc('38'), status: 'settled' },
  { id: 'p12', day: '2026-09-06', time: '08:44', agentId: 'pricer', payee: 'Brave Search', memo: 'Reference-number price check', category: 'Data & research', amount: usdc('17'), status: 'settled' },
]

// ─── derived figures ──────────────────────────────────────────────────────────
// Everything the stat rows render is computed, never hardcoded — so the screens stay honest
// when the fixtures are swapped for live data.

const sum = (xs: bigint[]): bigint => xs.reduce((a, b) => a + b, 0n)

export const rosterSpend = (): bigint => sum(agents.map((a) => a.periodSpend))
export const rosterCommitted = (): bigint => sum(agents.map((a) => a.perPeriodCap))
export const rosterUnspent = (): bigint => rosterCommitted() - rosterSpend()
export const awaitingApproval = (): bigint => sum(pendingRequests.map((r) => r.amount))

export const settledPayments = (): Payment[] => payments.filter((p) => p.status === 'settled')
export const settledTotal = (): bigint => sum(settledPayments().map((p) => p.amount))
export const heldTotal = (): bigint => sum(payments.filter((p) => p.status === 'held').map((p) => p.amount))
export const rejectedTotal = (): bigint => sum(payments.filter((p) => p.status === 'rejected').map((p) => p.amount))
export const largestPayment = (): bigint =>
  settledPayments().reduce((max, p) => (p.amount > max ? p.amount : max), 0n)

/** Day-grouped, newest day first, newest payment first within a day. */
export function paymentsByDay(filtered: Payment[]): Array<{ day: string; items: Payment[]; settled: bigint }> {
  const days = [...new Set(filtered.map((p) => p.day))].sort().reverse()
  return days.map((day) => {
    const items = filtered.filter((p) => p.day === day).sort((a, b) => b.time.localeCompare(a.time))
    return { day, items, settled: sum(items.filter((p) => p.status === 'settled').map((p) => p.amount)) }
  })
}

/** `TODAY · 8 SEPTEMBER` / `YESTERDAY · 7 SEPTEMBER` / `4 SEPTEMBER`. */
export function dayHeading(day: string): string {
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  const [y, m, d] = day.split('-').map(Number) as [number, number, number]
  const label = `${d} ${MONTHS[m - 1]!}`
  const today = new Date(`${DEMO_TODAY}T00:00:00Z`).getTime()
  const then = new Date(`${day}T00:00:00Z`).getTime()
  const diff = Math.round((today - then) / 86_400_000)
  if (diff === 0) return `Today · ${label}`
  if (diff === 1) return `Yesterday · ${label}`
  return label
}

export const ORG_NAME = 'Ellis Watch Co.'
export const PERIOD_LABEL = 'September 2026'
