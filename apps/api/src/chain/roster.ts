import { erc20Abi, parseEventLogs, type Address, type Hash, type Hex } from 'viem'
import { rosterAbi } from './abi.js'
import { publicClient, ownerClient, ownerAccount, relayerAccount, relayerClient, ROSTER_ADDRESS } from './chain.js'
import { loadEnv } from '../env.js'

/// Typed wrappers over the Allowance Contract. Every write simulates first: the simulation is
/// what turns a revert into a decodable custom error (`InsufficientBalance`, `AgentNotActive`,
/// …) instead of an opaque gas-estimation failure, and it means a call that would fail never
/// costs gas. http/errors.ts maps those names to owner-facing responses.
///
/// Nothing here re-checks a cap. The contract is the only enforcement point; a check in this
/// file would be a second, weaker one that could disagree with it.

export interface AgentInfo {
  perTxCap: bigint
  perPeriodCap: bigint
  periodSpend: bigint
  periodStart: bigint
  role: string
  registered: boolean
  active: boolean
}

export interface PendingRequest {
  agent: Address
  payee: Address
  amount: bigint
  memo: `0x${string}`
  open: boolean
}

const base = { address: ROSTER_ADDRESS, abi: rosterAbi } as const

// ─── reads ──────────────────────────────────────────────────────────────────

export async function getAgent(agent: Address): Promise<AgentInfo> {
  const info = await publicClient.readContract({ ...base, functionName: 'getAgent', args: [agent] })
  return info as AgentInfo
}

/// Reads every agent in parallel. Deliberately not `publicClient.multicall` — that needs a
/// Multicall3 deployment declared on the chain, and whether Arc testnet has one at the canonical
/// address is unverified. A roster is a handful of agents, so N parallel reads costs nothing and
/// removes a dependency that would fail at runtime rather than at compile time.
export async function getAgents(addresses: Address[]): Promise<Map<Address, AgentInfo>> {
  if (addresses.length === 0) return new Map()

  const infos = await Promise.all(addresses.map((agent) => getAgent(agent)))
  return new Map(addresses.map((address, i) => [address, infos[i]!]))
}

export async function getPendingRequest(requestId: bigint): Promise<PendingRequest> {
  const request = await publicClient.readContract({
    ...base,
    functionName: 'getPendingRequest',
    args: [requestId],
  })
  return request as PendingRequest
}

export async function getOwner(): Promise<Address> {
  return publicClient.readContract({ ...base, functionName: 'owner' })
}

export async function getPeriodLength(): Promise<bigint> {
  return publicClient.readContract({ ...base, functionName: 'PERIOD_LENGTH' })
}

const usdcBalanceOf = (account: Address): Promise<bigint> =>
  publicClient.readContract({ address: loadEnv().USDC_ADDRESS, abi: erc20Abi, functionName: 'balanceOf', args: [account] })

/// The one balance every agent spends from. No part of it belongs to any agent: a cap is
/// permission to spend, not a claim on funds, so this is also exactly what `withdrawTreasury`
/// can take.
export const getBalance = (): Promise<bigint> => usdcBalanceOf(ROSTER_ADDRESS)

/// USDC in the owner's own wallet — what "add money" can move into the Roster.
export const getOwnerWalletBalance = (): Promise<bigint> => usdcBalanceOf(ownerAccount.address)

// ─── writes ─────────────────────────────────────────────────────────────────

type WriteArgs = Parameters<typeof publicClient.simulateContract>[0]

/// Every owner write is signed by one account, and concurrent sends from one account race for the
/// same nonce ("replacement transaction underpriced") — two background hires finishing together,
/// or a hire landing during an approval, would collide. Sends go through this queue one at a time;
/// receipts are awaited outside it.
let ownerQueue: Promise<unknown> = Promise.resolve()

/// Simulate → send → wait, as the owner, through the queue. Callers get a mined transaction or a
/// decodable revert, never a hash whose outcome is still unknown: the approval flow in §4.3 has to
/// confirm `approvePending` succeeded *before* it tells the agent's session to retry.
async function sendAsOwner(call: Record<string, unknown>): Promise<Hash> {
  const submit = async (): Promise<Hash> => {
    const { request } = await publicClient.simulateContract({ ...call, account: ownerAccount } as unknown as WriteArgs)
    return ownerClient.writeContract(request as never)
  }

  const sent = ownerQueue.then(submit, submit)
  ownerQueue = sent.catch(() => undefined)
  const hash = await sent

  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error(`owner transaction reverted on-chain (${hash})`)
  return hash
}

const send = (functionName: string, args: readonly unknown[]) => sendAsOwner({ ...base, functionName, args })

/// "Add money": a plain USDC transfer from the owner's wallet to the Roster. The contract has no
/// deposit function — any transfer to its address is spendable at once (§4.6). Through the owner
/// queue like every other owner write, since it spends the same nonce.
export const depositFromOwner = (amount: bigint) =>
  sendAsOwner({ address: loadEnv().USDC_ADDRESS, abi: erc20Abi, functionName: 'transfer', args: [ROSTER_ADDRESS, amount] })

export const hireAgent = (agent: Address, perTxCap: bigint, perPeriodCap: bigint, role: string) =>
  send('hireAgent', [agent, perTxCap, perPeriodCap, role])

export const withdrawTreasury = (to: Address, amount: bigint) => send('withdrawTreasury', [to, amount])

export const updateCaps = (agent: Address, perTxCap: bigint, perPeriodCap: bigint) =>
  send('updateCaps', [agent, perTxCap, perPeriodCap])

export const revokeAgent = (agent: Address) => send('revokeAgent', [agent])

export const approvePending = (requestId: bigint) => send('approvePending', [requestId])

export const rejectPending = (requestId: bigint) => send('rejectPending', [requestId])

// ─── relayed spends (executeSpendFor) ───────────────────────────────────────

export { SPEND_TYPES } from './spend.js'

export interface SignedSpend {
  agent: Address
  amount: bigint
  payee: Address
  memo: Hex
  deadline: bigint
  signature: Hex
}

/// One relayer account submits for every agent, and concurrent sends from one account race for
/// the same nonce ("replacement transaction underpriced"). Sends go through this queue one at a
/// time; receipts are awaited outside it, so a slow block doesn't stall the next agent.
let relayQueue: Promise<unknown> = Promise.resolve()

/// Simulate → send → wait, as the relayer. A simulation revert surfaces as the contract's own
/// error (InvalidSignature, AgentNotActive, …) and costs no gas. Nothing here checks the
/// signature or a cap — that is the contract's job.
export async function relaySpend(spend: SignedSpend): Promise<{ executed: boolean; requestId?: bigint; transactionHash: Hash }> {
  const account = relayerAccount
  const client = relayerClient
  if (!account || !client) throw new Error('No relayer is configured (RELAYER_PRIVATE_KEY).')

  const submit = async (): Promise<Hash> => {
    const { request } = await publicClient.simulateContract({
      ...base,
      functionName: 'executeSpendFor',
      args: [spend.agent, spend.amount, spend.payee, spend.memo, spend.deadline, spend.signature],
      account,
    } as unknown as WriteArgs)
    return client.writeContract(request as never)
  }

  const sent = relayQueue.then(submit, submit)
  relayQueue = sent.catch(() => undefined)
  const transactionHash = await sent

  const receipt = await publicClient.waitForTransactionReceipt({ hash: transactionHash })
  if (receipt.status !== 'success') throw new Error(`executeSpendFor reverted on-chain (${transactionHash})`)

  const [held] = parseEventLogs({ abi: rosterAbi, eventName: 'PaymentPending', logs: receipt.logs })
  if (held) return { executed: false, requestId: (held.args as { requestId: bigint }).requestId, transactionHash }
  return { executed: true, transactionHash }
}
