import Link from 'next/link'
import { AddMoney } from '@/components/AddMoney'
import { AgentTable } from '@/components/AgentTable'
import { AutoRefresh } from '@/components/AutoRefresh'
import { Onboarding } from '@/components/Onboarding'
import { Stat, StatRow } from '@/components/Stat'
import { Unavailable } from '@/components/Unavailable'
import { InfoIcon, ArrowRight } from '@/components/Icons'
import { usd } from '@/lib/money'
import { attempt, loadRoster } from '@/lib/load'
import { heldBecause, roomThisMonth, sum, type Agent, type PendingRequest, type Treasury } from '@/lib/roster'
import { periodLabel } from '@/lib/org'

// Live chain state on every request — a cached roster would show a revoked agent as active.
export const dynamic = 'force-dynamic'

/** The alert banner's second sentence is the isolation guarantee stated in the UI, so it is
 *  derived from the roster rather than written as copy — if another agent were actually stalled,
 *  the sentence has to stop claiming otherwise. */
function PendingBanner({ agents, pending }: { agents: Agent[]; pending: PendingRequest[] }) {
  if (pending.length === 0) return null

  const request = pending[0]!
  const agent = agents.find((a) => a.id === request.agentId)
  if (!agent) return null

  const othersAllActive = agents.every((a) => a.id === agent.id || a.status === 'active')

  const title =
    pending.length === 1
      ? `${agent.name} is holding a ${usd(request.amount)} payment for your approval`
      : `${pending.length} payments are holding for your approval`

  return (
    <div className="banner">
      <span className="banner-icon"><InfoIcon /></span>
      <div className="banner-body">
        <div className="banner-title">{title}</div>
        <div className="banner-sub">
          {heldBecause(request)}{' '}
          {othersAllActive ? 'Every other agent is spending normally.' : 'No other agent is affected.'}
        </div>
      </div>
      <Link className="btn btn-outline" href={`/pending/${request.requestId}`}>
        Review request <ArrowRight />
      </Link>
    </div>
  )
}

/** Shown only when it is true: the agents' remaining monthly limits add up to more than the
 *  balance, so the balance — not the limits — is what will stop them. Limits above the balance
 *  are allowed and normal (they are permissions, not promises); this just says which one binds. */
function LowBalanceBanner({ agents, treasury }: { agents: Agent[]; treasury?: Treasury }) {
  if (!treasury) return null
  const room = roomThisMonth(agents)
  if (room <= treasury.balance) return null

  return (
    <div className="banner" data-state="warning">
      <span className="banner-icon"><InfoIcon /></span>
      <div className="banner-body">
        <div className="banner-title">
          {treasury.balance === 0n ? 'Your balance is empty' : 'Your balance is lower than your agents’ limits'}
        </div>
        <div className="banner-sub">
          Their monthly limits allow up to {usd(room)} more this month, and the balance is {usd(treasury.balance)}.
          Once it runs out, purchases are refused until you add money.
        </div>
      </div>
      <AddMoney available={usd(treasury.ownerBalance)} />
    </div>
  )
}

export default async function RosterOverview() {
  const label = periodLabel()
  const result = await attempt(() => loadRoster())

  if (!result.ok) {
    return (
      <>
        <span className="eyebrow">Balance</span>
        <Unavailable message={result.message} />
      </>
    )
  }

  const { agents, pending, hires, treasury } = result.value

  // The roster is the team you have now, so a fired agent drops off it. Its spend still counts
  // toward the month — the money left the balance and saying otherwise would be a second set of
  // books — but it holds no limit any more, so it is out of every forward-looking figure:
  // the agent count, the limits-versus-balance check, and the table.
  const team = agents.filter((a) => a.status !== 'revoked')
  const spent = sum(agents.map((a) => a.periodSpend))

  return (
    <>
      <div className="pagehead">
        <div>
          <span className="eyebrow">Balance</span>
          <div className="hero-line">
            <span className="hero">{treasury ? usd(treasury.balance) : '—'}</span>
            <span className="hero-note">shared by every agent, each within its own limits</span>
          </div>
          {treasury && (
            <div className="hero-actions">
              <AddMoney available={usd(treasury.ownerBalance)} />
            </div>
          )}
        </div>

        <StatRow>
          <Stat label="Agents">{team.length}</Stat>
          <Stat label={`Spent in ${label}`}>{usd(spent)}</Stat>
          <Stat label="Awaiting approval">{usd(sum(pending.map((r) => r.amount)))}</Stat>
        </StatRow>
      </div>

      <PendingBanner agents={team} pending={pending} />
      <LowBalanceBanner agents={team} treasury={treasury} />
      <Onboarding hires={hires} />
      <AgentTable agents={team} />
      {/* Only while something is still moving — a failed hire waits for the owner, not a timer. */}
      <AutoRefresh active={hires.some((h) => h.status !== 'failed')} />
    </>
  )
}
