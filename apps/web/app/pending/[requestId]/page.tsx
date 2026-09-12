import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, CornerArrow } from '@/components/Icons'
import { PendingDecision } from '@/components/PendingDecision'
import { Unavailable } from '@/components/Unavailable'
import { usd, usdWhole } from '@/lib/money'
import { attempt, loadPending } from '@/lib/load'
import { periodLabel } from '@/lib/org'

export const dynamic = 'force-dynamic'

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
  const result = await attempt(() => loadPending(requestId))

  if (!result.ok) {
    return (
      <>
        <Link className="backlink" href="/">
          <ArrowLeft /> Team
        </Link>
        <Unavailable message={result.message} />
      </>
    )
  }

  // Settled or never existed. Either way there is nothing left to decide.
  const request = result.value
  if (!request) notFound()

  const overTx = request.amount > request.perTxCap
  const capAfter = request.periodSpend + request.amount
  const month = periodLabel().split(' ')[0]

  return (
    <>
      <Link className="backlink" href="/">
        <ArrowLeft /> Team
      </Link>

      <div>
        <span className="eyebrow">Pending approval · Over its limit</span>
        <div className="hero-line">
          <span className="hero">{usd(request.amount)}</span>
          <span className="hero-note">to {request.payee}</span>
        </div>
      </div>

      {/* Full prose, not a memo field — the owner is deciding, and needs the sentence. */}
      <p className="prose">{request.purpose}</p>

      <div className="detail-strip">
        <Cell label="Requested by" value={request.agentName} sub={request.agentRole} />
        <Cell label="Category" value={request.category} sub={request.requestedAt || `Request #${request.requestId}`} />
        <Cell
          label="Per-purchase limit"
          value={usd(request.perTxCap)}
          sub={overTx ? `${usd(request.amount - request.perTxCap)} over` : 'Within limit'}
        />
        <Cell label="Spent this month, after" value={usdWhole(capAfter)} sub={`of its ${usdWhole(request.perPeriodCap)} limit`} />
      </div>

      {/* The most important line on the screen: it tells the owner the approval *is* the
          signature. §4.3 — approvePending releases the funds with no second step.

          It says "releases to {agent} to pay {payee}", not "settles to {payee}", because that is
          what the contract does: executeSpend and approvePending both transfer to the agent's own
          wallet, which then signs the x402 payment itself (§4.2). The payee on a request is the
          agent's declaration of intent — the contract never verifies it and never pays it. The
          cap is the guarantee; the destination is not, and the screen should not imply otherwise. */}
      <div className="callout">
        <span className="callout-mark"><CornerArrow /></span>
        <span>
          Approving releases <strong>{usd(request.amount)}</strong> from your balance to {request.agentName} to pay{' '}
          {request.payee} — there is no second confirmation, and it counts against {request.agentName}&rsquo;s {month}{' '}
          limit.
        </span>
      </div>

      <PendingDecision requestId={request.requestId} />
    </>
  )
}
