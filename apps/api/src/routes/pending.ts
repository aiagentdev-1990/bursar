import { Hono } from 'hono'
import { formatUnits } from 'viem'
import * as contract from '../chain/roster.js'
import { fetchRosterEvents, openRequestsFrom } from '../services/blockscout.js'
import { toPendingView } from '../services/view.js'
import { notifyFundsReleased, AgentRuntimeUnavailable } from '../services/agentRuntime.js'
import { ApiError } from '../http/errors.js'

/// §4.3. The over-cap path: held, never silently dropped, never force-executed.

export const pending = new Hono()

function requestIdFrom(raw: string): bigint {
  if (!/^\d+$/.test(raw)) throw new ApiError(400, 'invalid_request_id', 'Request id must be a whole number.')
  return BigInt(raw)
}

/// Reads the open set from the event log rather than scanning request ids on-chain — one call
/// for the whole roster, and it is the same derivation the dashboard uses.
pending.get('/', async (c) => {
  const open = openRequestsFrom(await fetchRosterEvents())
  if (open.length === 0) return c.json({ pending: [] })

  const infos = await contract.getAgents([...new Set(open.map((r) => r.agent))])

  return c.json({
    pending: open.map((request) => toPendingView(request, infos.get(request.agent)!)),
  })
})

pending.get('/:requestId', async (c) => {
  const requestId = requestIdFrom(c.req.param('requestId'))
  const request = await contract.getPendingRequest(requestId)

  if (!request.open) throw new ApiError(404, 'request_not_open', 'That request is no longer open.')

  const info = await contract.getAgent(request.agent)
  return c.json({
    pending: toPendingView({ ...request, requestId, transactionHash: '0x' }, info),
  })
})

// ─── approve ────────────────────────────────────────────────────────────────

pending.post('/:requestId/approve', async (c) => {
  const requestId = requestIdFrom(c.req.param('requestId'))

  // Read the request before approving: once it settles, `open` is false and the payee and
  // amount are needed for the session event below.
  const request = await contract.getPendingRequest(requestId)
  if (!request.open) throw new ApiError(409, 'request_not_open', 'That request has already been settled.')

  // Confirmed on-chain before anything is told to retry — contract.approvePending waits for the
  // receipt. Telling the agent funds are available before they are would have it retry a
  // payment it cannot make.
  const transactionHash = await contract.approvePending(requestId)

  // Sent by this service rather than inferred from the event stream: `SpendExecuted` also fires
  // on §4.2's ordinary in-cap path, so the stream alone cannot say which spend came from an
  // approval. We already know, right here.
  let resumed: 'sent' | 'no-session' | 'unavailable' = 'unavailable'
  try {
    resumed = await notifyFundsReleased({
      wallet: request.agent,
      amount: formatUnits(request.amount, 6),
      payee: request.payee,
    })
  } catch (error) {
    // The funds moved. A failure to nudge the session does not undo that, and must not be
    // reported as a failed approval.
    if (!(error instanceof AgentRuntimeUnavailable)) console.error('[roster-api] session resume failed', error)
  }

  return c.json({ approved: true, requestId: requestId.toString(), transactionHash, resumed })
})

// ─── reject ─────────────────────────────────────────────────────────────────

pending.post('/:requestId/reject', async (c) => {
  const requestId = requestIdFrom(c.req.param('requestId'))

  // No funds move and no session event fires — the agent is not told to retry something the
  // owner declined.
  const transactionHash = await contract.rejectPending(requestId)

  return c.json({ rejected: true, requestId: requestId.toString(), transactionHash })
})
