// The dashboard's view types and the pure derivations over them. Safe to import from client
// components — the loading half lives in lib/load.ts, which is server-only.
//
// Every amount is a bigint in USDC base units, exactly as the contract stores it (DECISIONS.md
// 2026-09-09). Figures on screen are computed from these, never hardcoded, so the stat rows
// always describe the rows beneath them.

import { usd, usdWhole } from './money'
import type { Category } from './categories'

export type AgentStatus = 'active' | 'needs-review' | 'revoked'
export type PaymentStatus = 'settled' | 'held' | 'rejected'
export type HireStatus = 'starting' | 'setting-up' | 'registering' | 'briefing' | 'active' | 'failed'

/** A hire still in flight, or one that failed and hasn't been dismissed. */
export interface Hire {
  id: string
  name: string
  role: string
  status: HireStatus
  failedAt?: HireStatus
  /** Whether its limits reached the chain. Decides what a failure message has to say. */
  registered: boolean
  error?: string
  /** The agent's Claude session, to watch it set itself up. */
  traceUrl?: string
}

/** One line on where a hire has got to — the owner is watching it happen. */
export function hireProgress(hire: Hire): string {
  switch (hire.status) {
    case 'starting':
      return 'Creating the agent and its session…'
    case 'setting-up':
      return 'Setting up its wallet. This usually takes a minute or two.'
    case 'registering':
      return 'Setting its spending limits on-chain…'
    case 'briefing':
      return 'Handing it the roster details…'
    case 'active':
      return 'On the roster.'
    case 'failed':
      return `${hire.error ?? 'Something went wrong.'} ${
        hire.registered ? 'It is on the roster, with its limits enforced.' : 'Nothing was registered on-chain.'
      }`
  }
}

export interface Agent {
  /** Opaque API handle. The owner never sees a wallet address or an agent id (§4.1) — this is a
   *  routing key only, and never rendered. */
  id: string
  name: string
  role: string
  category: Category
  /** Per-purchase limit. Anything over it waits for the owner. */
  perTxCap: bigint
  /** Monthly limit. */
  perPeriodCap: bigint
  /** The period the contract will enforce right now — `getAgent` applies the lazy reset. */
  periodSpend: bigint
  status: AgentStatus
  /** Relative, rendered on the server: `6 minutes ago`. */
  lastActivity: string
  /** Sparkline series, oldest first. Unitless — shape only. */
  trend: number[]
}

/** The roster's one balance — a company account behind every agent's expense card. Agents spend
 *  from it within their own limits; no part of it is set aside for any one agent. */
export interface Treasury {
  balance: bigint
  /** What the owner's own wallet holds, i.e. what "Add money" can move in. */
  ownerBalance: bigint
}

/** What active agents could still spend this month without asking, each floored at zero: an
 *  approval can carry an agent past its limit, and that overshoot is not negative room for the
 *  others. When this exceeds the balance, the balance — not the limits — is what will stop them. */
export function roomThisMonth(agents: Agent[]): bigint {
  return sum(
    agents
      .filter((a) => a.status !== 'revoked')
      .map((a) => (a.perPeriodCap > a.periodSpend ? a.perPeriodCap - a.periodSpend : 0n)),
  )
}

export interface PendingRequest {
  requestId: string
  agentId: string
  agentName: string
  agentRole: string
  category: Category
  /** Display name from the memo, or a shortened address when the agent gave none. */
  payee: string
  purpose: string
  amount: bigint
  perTxCap: bigint
  periodSpend: bigint
  perPeriodCap: bigint
  /** `Today, 09:12`. Empty when the explorer has not indexed the request yet. */
  requestedAt: string
}

export interface Payment {
  id: string
  /** Local `YYYY-MM-DD`, for day grouping, or `unknown` if the block had no timestamp. */
  day: string
  time: string
  agentId: string
  agentName: string
  payee: string
  memo: string
  category: Category
  amount: bigint
  status: PaymentStatus
}

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export const sum = (xs: bigint[]): bigint => xs.reduce((a, b) => a + b, 0n)

const pad = (n: number) => String(n).padStart(2, '0')
export const dayKey = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const clock = (d: Date): string => `${pad(d.getHours())}:${pad(d.getMinutes())}`

export const shortAddress = (address: string): string =>
  address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address

/** Memos are free text an agent writes on-chain. The seed script (and any agent that wants a
 *  payee name shown) writes `Payee — what it was for`; anything else is all description. */
export function splitMemo(memo: string): { payee?: string; detail: string } {
  const at = memo.indexOf(' — ')
  if (at <= 0) return { detail: memo }
  return { payee: memo.slice(0, at), detail: memo.slice(at + 3) }
}

/** Why a request is held. Either limit can do it, and the copy has to name the right one. */
export function heldBecause(r: Pick<PendingRequest, 'amount' | 'perTxCap' | 'periodSpend' | 'perPeriodCap'>): string {
  if (r.amount > r.perTxCap) return `${usd(r.amount - r.perTxCap)} above its ${usd(r.perTxCap)} per-purchase limit.`
  return `It would take this month's spend to ${usd(r.periodSpend + r.amount)}, past its ${usdWhole(r.perPeriodCap)} monthly limit.`
}

/** Day-grouped, newest day first, newest payment first within a day. */
export function paymentsByDay(filtered: Payment[]): Array<{ day: string; items: Payment[]; settled: bigint }> {
  const days = [...new Set(filtered.map((p) => p.day))].sort().reverse()
  return days.map((day) => {
    // Stable sort: payments in the same minute keep the explorer's newest-first order.
    const items = filtered.filter((p) => p.day === day).sort((a, b) => b.time.localeCompare(a.time))
    return { day, items, settled: sum(items.filter((p) => p.status === 'settled').map((p) => p.amount)) }
  })
}

/** `Today · 8 September` / `Yesterday · 7 September` / `4 September`. `today` comes from the
 *  server, so a client re-render cannot disagree with the HTML it hydrates. */
export function dayHeading(day: string, today: string): string {
  if (day === 'unknown') return 'Date unavailable'
  const [, m, d] = day.split('-').map(Number) as [number, number, number]
  const label = `${d} ${MONTHS[m - 1]!}`
  const diff = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000)
  if (diff === 0) return `Today · ${label}`
  if (diff === 1) return `Yesterday · ${label}`
  return label
}
