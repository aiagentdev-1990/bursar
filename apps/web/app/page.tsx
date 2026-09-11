import Link from 'next/link'
import { AgentTable } from '@/components/AgentTable'
import { AutoRefresh } from '@/components/AutoRefresh'
import { Onboarding } from '@/components/Onboarding'
import { Stat, StatRow } from '@/components/Stat'
import { Unavailable } from '@/components/Unavailable'
import { InfoIcon, ArrowRight } from '@/components/Icons'
import { usd, usdWhole } from '@/lib/money'
import { attempt, loadRoster } from '@/lib/load'
import { heldBecause, sum, type Agent, type PendingRequest } from '@/lib/roster'
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

export default async function RosterOverview() {
  const label = periodLabel()
  const result = await attempt(() => loadRoster())

  if (!result.ok) {
    return (
      <>
        <span className="eyebrow">Roster spend · {label}</span>
        <Unavailable message={result.message} />
      </>
    )
  }

  const { agents, pending, hires } = result.value
  const spend = sum(agents.map((a) => a.periodSpend))
  const committed = sum(agents.map((a) => a.perPeriodCap))
  // Per agent, floored at zero: an approval can legitimately carry an agent past its cap, and
  // that overshoot is not negative headroom on everyone else.
  const unspent = sum(agents.map((a) => (a.perPeriodCap > a.periodSpend ? a.perPeriodCap - a.periodSpend : 0n)))

  return (
    <>
      <div className="pagehead">
        <div>
          <span className="eyebrow">Roster spend · {label}</span>
          <div className="hero-line">
            <span className="hero">{usd(spend)}</span>
            <span className="hero-note">of {usdWhole(committed)} committed</span>
          </div>
        </div>

        <StatRow>
          <Stat label="Agents">{agents.length}</Stat>
          <Stat label="Awaiting approval">{usd(sum(pending.map((r) => r.amount)))}</Stat>
          <Stat label="Unspent">{usdWhole(unspent)}</Stat>
        </StatRow>
      </div>

      <PendingBanner agents={agents} pending={pending} />
      <Onboarding hires={hires} />
      <AgentTable agents={agents} />
      {/* Only while something is still moving — a failed hire waits for the owner, not a timer. */}
      <AutoRefresh active={hires.some((h) => h.status !== 'failed')} />
    </>
  )
}
