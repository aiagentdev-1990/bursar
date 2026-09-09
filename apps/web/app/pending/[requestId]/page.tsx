import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, CornerArrow } from '@/components/Icons'
import { usd, usdWhole } from '@/lib/money'
import { findAgent, findPending, pendingRequests, PERIOD_LABEL } from '@/lib/mock-data'

export function generateStaticParams() {
  return pendingRequests.map((r) => ({ requestId: r.requestId }))
}

function Cell({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="detail-cell">
      <span className="eyebrow">{label}</span>
      <div className="detail-value">{value}</div>
      <div className="detail-sub">{sub}</div>
    </div>
  )
}

export default async function PendingApproval({ params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params
  const request = findPending(requestId)
  if (!request) notFound()

  const agent = findAgent(request.agentId)
  if (!agent) notFound()

  const over = request.amount - agent.perTxCap
  const capAfter = agent.periodSpend + request.amount
  const month = PERIOD_LABEL.split(' ')[0]

  return (
    <>
      <Link className="backlink" href="/">
        <ArrowLeft /> Roster
      </Link>

      <div>
        <span className="eyebrow">Pending approval · Over cap</span>
        <div className="hero-line">
          <span className="hero">{usd(request.amount)}</span>
          <span className="hero-note">to {request.payee}</span>
        </div>
      </div>

      {/* Full prose, not a memo field — the owner is deciding, and needs the sentence. */}
      <p className="prose">{request.purpose}</p>

      <div className="detail-strip">
        <Cell label="Requested by" value={agent.name} sub={agent.role} />
        <Cell label="Category" value={request.category} sub={request.requestedAt} />
        <Cell label="Per-transaction limit" value={usd(agent.perTxCap)} sub={`${usd(over)} over`} />
        <Cell label="Monthly cap after" value={usdWhole(capAfter)} sub={`of ${usdWhole(agent.perPeriodCap)}`} />
      </div>

      {/* The most important line on the screen: it tells the owner the approval *is* the
          signature. §4.3 — approvePending releases the funds with no second step. */}
      <div className="callout">
        <span className="callout-mark"><CornerArrow /></span>
        <span>
          Approving settles <strong>{usd(request.amount)}</strong> to {request.payee} immediately — there is no
          second confirmation, and it counts against {agent.name}&rsquo;s {month} cap.
        </span>
      </div>

      {/* Inert at checkpoint 8. Checkpoint 6 wires these to POST /pending/:requestId/approve and
          /reject; approve then sends the Claude session-resume event (§4.3), never inferred from
          the SpendExecuted stream. */}
      <div className="actions">
        <button type="button" className="btn btn-quiet">Reject</button>
        <button type="button" className="btn btn-primary">Approve payment</button>
      </div>
    </>
  )
}
