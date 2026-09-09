import Link from 'next/link'
import { AgentTable } from '@/components/AgentTable'
import { Stat, StatRow } from '@/components/Stat'
import { InfoIcon, ArrowRight } from '@/components/Icons'
import { usd, usdWhole } from '@/lib/money'
import {
  agents,
  findAgent,
  pendingRequests,
  rosterSpend,
  rosterCommitted,
  rosterUnspent,
  awaitingApproval,
  PERIOD_LABEL,
} from '@/lib/mock-data'

/** The alert banner's second sentence is the isolation guarantee stated in the UI, so it is
 *  derived from the roster rather than written as copy — if another agent were actually stalled,
 *  the sentence has to stop claiming otherwise. */
function PendingBanner() {
  if (pendingRequests.length === 0) return null

  const request = pendingRequests[0]!
  const agent = findAgent(request.agentId)
  if (!agent) return null

  const over = request.amount - agent.perTxCap
  const othersAllActive = agents.every((a) => a.id === agent.id || a.status === 'active')

  const title =
    pendingRequests.length === 1
      ? `${agent.name} is holding a ${usd(request.amount)} payment for your approval`
      : `${pendingRequests.length} payments are holding for your approval`

  return (
    <div className="banner">
      <span className="banner-icon"><InfoIcon /></span>
      <div className="banner-body">
        <div className="banner-title">{title}</div>
        <div className="banner-sub">
          {usd(over)} above its {usd(agent.perTxCap)} per-transaction limit.{' '}
          {othersAllActive ? 'Every other agent is spending normally.' : 'No other agent is affected.'}
        </div>
      </div>
      <Link className="btn btn-outline" href={`/pending/${request.requestId}`}>
        Review request <ArrowRight />
      </Link>
    </div>
  )
}

export default function RosterOverview() {
  return (
    <>
      <div className="pagehead">
        <div>
          <span className="eyebrow">Roster spend · {PERIOD_LABEL}</span>
          <div className="hero-line">
            <span className="hero">{usd(rosterSpend())}</span>
            <span className="hero-note">of {usdWhole(rosterCommitted())} committed</span>
          </div>
        </div>

        <StatRow>
          <Stat label="Agents">{agents.length}</Stat>
          <Stat label="Awaiting approval">{usd(awaitingApproval())}</Stat>
          <Stat label="Unspent">{usdWhole(rosterUnspent())}</Stat>
        </StatRow>
      </div>

      <PendingBanner />
      <AgentTable />
    </>
  )
}
