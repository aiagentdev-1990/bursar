import { hexToString, type Address, type Hex } from 'viem'
import type { AgentInfo } from '../chain/roster.js'
import type { OpenRequest, RosterEvent } from './blockscout.js'
import { decodeLabel } from './labels.js'
import { agentId } from './ids.js'

/// Wire shapes. Two rules, both from CLAUDE.md:
///
///   Money crosses this boundary as a base-unit decimal string ("400000000"), never a number.
///   JSON has no bigint and no exact decimal, so a float here would silently round a USDC
///   amount. The web app parses at its own edge.
///
///   No wallet addresses and no agent ids in any response body.

export type AgentStatus = 'active' | 'needs-review' | 'revoked'

export interface AgentView {
  id: string
  name: string
  role: string
  perTxCap: string
  perPeriodCap: string
  periodSpend: string
  earmarkedBalance: string
  periodStart: string
  status: AgentStatus
  lastActivityAt?: string
}

export function toAgentView(
  address: Address,
  info: AgentInfo,
  opts: { hasOpenRequest: boolean; lastActivityAt?: string },
): AgentView {
  const label = decodeLabel(info.role)

  return {
    id: agentId(address),
    name: label.name,
    role: label.role,
    perTxCap: info.perTxCap.toString(),
    perPeriodCap: info.perPeriodCap.toString(),
    periodSpend: info.periodSpend.toString(),
    earmarkedBalance: info.earmarkedBalance.toString(),
    periodStart: info.periodStart.toString(),
    status: !info.active ? 'revoked' : opts.hasOpenRequest ? 'needs-review' : 'active',
    lastActivityAt: opts.lastActivityAt,
  }
}

export interface PendingView {
  requestId: string
  agentId: string
  agentName: string
  agentRole: string
  payee: Address
  purpose: string
  amount: string
  perTxCap: string
  periodSpend: string
  perPeriodCap: string
  requestedAt?: string
}

export function toPendingView(request: OpenRequest, info: AgentInfo): PendingView {
  const label = decodeLabel(info.role)

  return {
    requestId: request.requestId.toString(),
    agentId: agentId(request.agent),
    agentName: label.name,
    agentRole: label.role,
    // The payee is a third party the owner is about to pay. That one they do need to see.
    payee: request.payee,
    purpose: decodeMemo(request.memo),
    amount: request.amount.toString(),
    perTxCap: info.perTxCap.toString(),
    periodSpend: info.periodSpend.toString(),
    perPeriodCap: info.perPeriodCap.toString(),
    requestedAt: request.timestamp,
  }
}

export interface ActivityView {
  type: RosterEvent['name']
  agentId?: string
  agentName?: string
  payee?: Address
  amount?: string
  memo?: string
  at?: string
  transactionHash: Hex
}

export function toActivityView(
  event: RosterEvent,
  nameFor: (address: Address) => string | undefined,
): ActivityView {
  const agent = event.args.agent as Address | undefined
  const amount = event.args.amount as bigint | undefined
  const memo = event.args.memo as Hex | undefined

  return {
    type: event.name,
    agentId: agent ? agentId(agent) : undefined,
    agentName: agent ? nameFor(agent) : undefined,
    payee: event.args.payee as Address | undefined,
    amount: amount !== undefined ? amount.toString() : undefined,
    memo: memo ? decodeMemo(memo) : undefined,
    at: event.timestamp,
    transactionHash: event.transactionHash,
  }
}

/// The memo is free-form bytes written by an agent. Decode it for display, strip any NULs, and
/// never let a malformed one take down the feed.
function decodeMemo(memo: Hex): string {
  if (!memo || memo === '0x') return ''
  try {
    return hexToString(memo).replace(/\u0000/g, '')
  } catch {
    return ''
  }
}
