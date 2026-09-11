import { decodeEventLog, type Address, type Hex } from 'viem'
import { rosterAbi } from '../chain/abi.js'
import { loadEnv } from '../env.js'
import { ROSTER_ADDRESS } from '../chain/chain.js'
import { ApiError } from '../http/errors.js'

/// The read layer (§4.5). There is no indexer: history is Blockscout's indexed event log,
/// decoded here with the same ABI the writes use.
///
/// Note the split. Blockscout answers "what happened" — the activity feed, which agents exist,
/// which requests are still open. Current per-agent state (period spend, caps, active) comes
/// from `getAgent` instead, because reconstructing it from events would mean reimplementing the
/// contract's lazy period reset in TypeScript. A second implementation of cap arithmetic is
/// exactly the thing that can disagree with the contract, and for this product a dashboard that
/// disagrees with the enforcement is worse than one extra call.
///
/// `getAgent` applies that reset to what it returns, so the period it reports is the one the
/// next spend will enforce — nothing here has to adjust for a crossed boundary.

const env = loadEnv()

export type RosterEventName =
  | 'AgentRegistered'
  | 'TreasuryWithdrawn'
  | 'SpendExecuted'
  | 'PaymentPending'
  | 'PendingApproved'
  | 'PendingRejected'
  | 'CapsUpdated'
  | 'AgentRevoked'
  | 'RosterInitialized'

export interface RosterEvent {
  name: RosterEventName
  args: Record<string, unknown>
  blockNumber: bigint
  /// ISO-8601, from the block. Undefined if this Blockscout deployment omits it.
  timestamp?: string
  transactionHash: Hex
  logIndex: number
}

interface BlockscoutLog {
  topics: (Hex | null)[]
  data: Hex
  block_number: number
  block_timestamp?: string
  transaction_hash: Hex
  index: number
}

interface BlockscoutPage {
  items: BlockscoutLog[]
  next_page_params: Record<string, string | number> | null
}

const MAX_PAGES = 20

async function fetchPage(params: Record<string, string | number> | null): Promise<BlockscoutPage> {
  const url = new URL(`${env.BLOCKSCOUT_API_URL.replace(/\/$/, '')}/api/v2/addresses/${ROSTER_ADDRESS}/logs`)
  for (const [key, value] of Object.entries(params ?? {})) url.searchParams.set(key, String(value))

  const response = await fetch(url, {
    headers: env.BLOCKSCOUT_API_KEY ? { 'api-key': env.BLOCKSCOUT_API_KEY } : undefined,
  })

  if (!response.ok) {
    throw new ApiError(502, 'blockscout_unavailable', `Blockscout returned ${response.status}.`)
  }

  return (await response.json()) as BlockscoutPage
}

/// Every Roster log, newest first. Logs this ABI can't decode are skipped rather than thrown on:
/// an unknown topic means the explorer returned something from a different contract version, and
/// one stray entry should not blank the whole dashboard.
export async function fetchRosterEvents(): Promise<RosterEvent[]> {
  const events: RosterEvent[] = []
  let params: Record<string, string | number> | null = null

  for (let page = 0; page < MAX_PAGES; page++) {
    const body: BlockscoutPage = await fetchPage(params)

    for (const log of body.items) {
      const decoded = tryDecode(log)
      if (decoded) events.push(decoded)
    }

    if (!body.next_page_params) break
    params = body.next_page_params
  }

  return events
}

function tryDecode(log: BlockscoutLog): RosterEvent | undefined {
  try {
    const { eventName, args } = decodeEventLog({
      abi: rosterAbi,
      topics: log.topics.filter((t): t is Hex => t !== null) as [Hex, ...Hex[]],
      data: log.data,
    })

    return {
      name: eventName as RosterEventName,
      args: (args ?? {}) as Record<string, unknown>,
      blockNumber: BigInt(log.block_number),
      timestamp: log.block_timestamp,
      transactionHash: log.transaction_hash,
      logIndex: log.index,
    }
  } catch {
    return undefined
  }
}

/// The roster's membership. There is deliberately no on-chain enumeration — `revokeAgent` must
/// never loop over agents — so the event log is where the list of agents comes from.
///
/// In hire order, oldest first. The log arrives newest first, which would reshuffle the roster
/// table every time someone new is hired.
export function agentAddressesFrom(events: RosterEvent[]): Address[] {
  const seen = new Set<Address>()
  for (const event of [...events].reverse()) {
    if (event.name === 'AgentRegistered') seen.add(event.args.agent as Address)
  }
  return [...seen]
}

export interface OpenRequest {
  requestId: bigint
  agent: Address
  payee: Address
  amount: bigint
  memo: Hex
  timestamp?: string
  transactionHash: Hex
}

/// A request is open until an Approved or Rejected event closes it. Derived from the log rather
/// than by scanning request ids on-chain, so it costs one Blockscout call for the whole roster.
export function openRequestsFrom(events: RosterEvent[]): OpenRequest[] {
  const settled = new Set<string>()
  for (const event of events) {
    if (event.name === 'PendingApproved' || event.name === 'PendingRejected') {
      settled.add(String(event.args.requestId))
    }
  }

  return events
    .filter((e) => e.name === 'PaymentPending' && !settled.has(String(e.args.requestId)))
    .map((e) => ({
      requestId: e.args.requestId as bigint,
      agent: e.args.agent as Address,
      payee: e.args.payee as Address,
      amount: e.args.amount as bigint,
      memo: e.args.memo as Hex,
      timestamp: e.timestamp,
      transactionHash: e.transactionHash,
    }))
}
