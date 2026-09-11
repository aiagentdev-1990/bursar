// Server-only: turns apps/api's wire shapes into the dashboard's view types. Replaces the
// checkpoint-8 fixtures. The API sends money as base-unit decimal strings (never a JSON number,
// which would round a USDC amount), and they become bigints here, at the edge.
//
// Where each figure comes from (§4.5): caps, period spend and active status are the contract's
// own `getAgent`; the balance is the Roster's USDC balance; membership, history and the
// open-request set are the event log via Blockscout. Nothing here recomputes cap or period arithmetic — a second implementation of it
// is the thing that could disagree with the contract.

import { api, ApiRequestError, ApiUnavailable } from './api'
import { categoryForRole } from './categories'
import {
  MONTHS,
  clock,
  dayKey,
  shortAddress,
  splitMemo,
  type Agent,
  type AgentStatus,
  type Hire,
  type HireStatus,
  type Payment,
  type PaymentStatus,
  type PendingRequest,
  type Treasury,
} from './roster'

// ─── wire shapes (apps/api/src/services/view.ts) ─────────────────────────────

interface AgentWire {
  id: string
  name: string
  role: string
  perTxCap: string
  perPeriodCap: string
  periodSpend?: string
  status: AgentStatus
  lastActivityAt?: string
}

interface PendingWire {
  requestId: string
  agentId: string
  agentName: string
  agentRole: string
  payee: string
  purpose: string
  amount: string
  perTxCap: string
  periodSpend: string
  perPeriodCap: string
  requestedAt?: string
}

interface ActivityWire {
  type: string
  requestId?: string
  agentId?: string
  agentName?: string
  payee?: string
  amount?: string
  memo?: string
  at?: string
  transactionHash: string
}

interface TreasuryWire {
  balance: string
  ownerBalance?: string
}

interface HireWire {
  id: string
  name: string
  role: string
  status: HireStatus
  failedAt?: HireStatus
  registered: boolean
  error?: string
  traceUrl?: string
}

// ─── loading ─────────────────────────────────────────────────────────────────

export interface RosterData {
  agents: Agent[]
  pending: PendingRequest[]
  payments: Payment[]
  /** Hires still in flight, and failures not yet dismissed. Finished hires are in `agents`. */
  hires: Hire[]
  /** The shared balance. Undefined if it could not be read — the roster still renders. */
  treasury?: Treasury
  /** Local `YYYY-MM-DD` on the server, for day headings. */
  today: string
}

export async function loadRoster(now = new Date()): Promise<RosterData> {
  const [agentsBody, pendingBody, activityBody, hires, treasury] = await Promise.all([
    api<{ agents: AgentWire[] }>('/agents'),
    api<{ pending: PendingWire[] }>('/pending'),
    api<{ activity: ActivityWire[] }>('/activity'),
    loadHires(),
    loadTreasury(),
  ])

  const roles = new Map(agentsBody.agents.map((a) => [a.id, a.role]))
  const payments = toPayments(activityBody.activity, roles)

  return {
    agents: agentsBody.agents.map((a) => toAgent(a, payments, now)),
    pending: pendingBody.pending.map((p) => toPending(p, now)),
    payments,
    hires,
    treasury,
    today: dayKey(now),
  }
}

async function loadTreasury(): Promise<Treasury | undefined> {
  try {
    const { treasury } = await api<{ treasury: TreasuryWire }>('/treasury')
    return { balance: big(treasury.balance), ownerBalance: big(treasury.ownerBalance) }
  } catch (error) {
    // The balance is one figure on the page; failing to read it should not blank the roster.
    if (error instanceof ApiRequestError) return undefined
    throw error
  }
}

async function loadHires(): Promise<Hire[]> {
  try {
    const body = await api<{ hires: HireWire[] }>('/agents/hires')
    return body.hires
      .filter((h) => h.status !== 'active')
      .map(({ id, name, role, status, failedAt, registered, error, traceUrl }) => ({
        id,
        name,
        role,
        status,
        failedAt,
        registered,
        error,
        traceUrl,
      }))
  } catch (error) {
    // An API from before background hires answers 404 here. The roster still renders without them.
    if (error instanceof ApiRequestError && error.status === 404) return []
    throw error
  }
}

/// One held request, or undefined if it is not open (settled, or never existed). Open-ness and
/// amounts come from the contract; the request time only exists in the event log, so it is
/// taken from the list when the explorer has indexed it.
export async function loadPending(requestId: string, now = new Date()): Promise<PendingRequest | undefined> {
  if (!/^\d+$/.test(requestId)) return undefined

  let detail: PendingWire
  try {
    detail = (await api<{ pending: PendingWire }>(`/pending/${requestId}`)).pending
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) return undefined
    throw error
  }

  const listed = await api<{ pending: PendingWire[] }>('/pending')
    .then((body) => body.pending.find((p) => p.requestId === requestId))
    .catch(() => undefined)

  return toPending({ ...detail, requestedAt: listed?.requestedAt ?? detail.requestedAt }, now)
}

export type Attempt<T> = { ok: true; value: T } | { ok: false; message: string }

/// API failures become a banner, not an error page. Anything else is a bug and still throws.
export async function attempt<T>(load: () => Promise<T>): Promise<Attempt<T>> {
  try {
    return { ok: true, value: await load() }
  } catch (error) {
    if (error instanceof ApiUnavailable || error instanceof ApiRequestError) return { ok: false, message: error.message }
    throw error
  }
}

// ─── mapping ─────────────────────────────────────────────────────────────────

const big = (v: string | undefined): bigint => (v && /^\d+$/.test(v) ? BigInt(v) : 0n)

function toAgent(wire: AgentWire, payments: Payment[], now: Date): Agent {
  // Cumulative settled spend, oldest first — the shape of how this agent has been spending.
  const settled = payments.filter((p) => p.agentId === wire.id && p.status === 'settled').reverse()
  let running = 0n
  const trend = [0, ...settled.map((p) => Number((running += p.amount)))].slice(-12)

  return {
    id: wire.id,
    name: wire.name || 'Unnamed agent',
    role: wire.role,
    category: categoryForRole(wire.role),
    perTxCap: big(wire.perTxCap),
    perPeriodCap: big(wire.perPeriodCap),
    periodSpend: big(wire.periodSpend),
    status: wire.status,
    lastActivity: wire.lastActivityAt ? relative(wire.lastActivityAt, now) : '—',
    trend,
  }
}

function toPending(wire: PendingWire, now: Date): PendingRequest {
  const memo = splitMemo(wire.purpose)
  return {
    requestId: wire.requestId,
    agentId: wire.agentId,
    agentName: wire.agentName || 'Unnamed agent',
    agentRole: wire.agentRole,
    category: categoryForRole(wire.agentRole),
    payee: memo.payee ?? shortAddress(wire.payee),
    purpose: memo.detail || 'The agent gave no description with this request.',
    amount: big(wire.amount),
    perTxCap: big(wire.perTxCap),
    periodSpend: big(wire.periodSpend),
    perPeriodCap: big(wire.perPeriodCap),
    requestedAt: wire.requestedAt ? stamp(wire.requestedAt, now) : '',
  }
}

/// The payment list: every executed spend, plus every held request that did not end in a spend.
/// An approved request is shown once, as the `SpendExecuted` its approval caused — not twice.
function toPayments(rows: ActivityWire[], roles: Map<string, string>): Payment[] {
  const approved = new Set(rows.filter((r) => r.type === 'PendingApproved').map((r) => r.requestId))
  const rejected = new Set(rows.filter((r) => r.type === 'PendingRejected').map((r) => r.requestId))

  const payments: Payment[] = []
  for (const row of rows) {
    let status: PaymentStatus
    if (row.type === 'SpendExecuted') status = 'settled'
    else if (row.type === 'PaymentPending') {
      if (approved.has(row.requestId)) continue
      status = rejected.has(row.requestId) ? 'rejected' : 'held'
    } else continue

    const when = row.at ? new Date(row.at) : undefined
    const valid = when && !Number.isNaN(when.getTime())
    const memo = splitMemo(row.memo ?? '')

    payments.push({
      id: `${row.transactionHash}:${row.type}`,
      day: valid ? dayKey(when) : 'unknown',
      time: valid ? clock(when) : '—',
      agentId: row.agentId ?? '',
      agentName: row.agentName || '—',
      payee: memo.payee ?? (row.payee ? shortAddress(row.payee) : '—'),
      memo: memo.detail,
      category: categoryForRole(roles.get(row.agentId ?? '') ?? ''),
      amount: big(row.amount),
      status,
    })
  }
  return payments
}

function relative(iso: string, now: Date): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return '—'
  const seconds = Math.max(0, Math.round((now.getTime() - then) / 1000))
  if (seconds < 60) return 'Just now'
  const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'} ago`
  if (seconds < 3600) return unit(Math.floor(seconds / 60), 'minute')
  if (seconds < 86_400) return unit(Math.floor(seconds / 3600), 'hour')
  return unit(Math.floor(seconds / 86_400), 'day')
}

/// `Today, 09:12` / `Yesterday, 16:41` / `6 September, 14:10`.
function stamp(iso: string, now: Date): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const diff = Math.round((Date.parse(`${dayKey(now)}T00:00:00Z`) - Date.parse(`${dayKey(d)}T00:00:00Z`)) / 86_400_000)
  if (diff === 0) return `Today, ${clock(d)}`
  if (diff === 1) return `Yesterday, ${clock(d)}`
  return `${d.getDate()} ${MONTHS[d.getMonth()]!}, ${clock(d)}`
}
