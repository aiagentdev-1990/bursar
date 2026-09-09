import type { Address, Hash } from 'viem'
import { rosterAbi } from './abi.js'
import { publicClient, ownerClient, ownerAccount, ROSTER_ADDRESS } from './chain.js'
import { loadEnv } from '../env.js'

/// Typed wrappers over the Allowance Contract. Every write simulates first: the simulation is
/// what turns a revert into a decodable custom error (`InsufficientTreasury`, `AgentNotActive`,
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
  earmarkedBalance: bigint
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

export async function getTotalEarmarked(): Promise<bigint> {
  return publicClient.readContract({ ...base, functionName: 'totalEarmarked' })
}

/// USDC the Roster holds that no agent is entitled to — what `withdrawTreasury` is bounded by,
/// and the headroom `fundAgent` has left.
export async function getUnallocatedTreasury(): Promise<bigint> {
  const [balance, earmarked] = await Promise.all([
    publicClient.readContract({
      address: loadEnv().USDC_ADDRESS,
      abi: erc20BalanceOfAbi,
      functionName: 'balanceOf',
      args: [ROSTER_ADDRESS],
    }),
    getTotalEarmarked(),
  ])
  return balance - earmarked
}

const erc20BalanceOfAbi = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

// ─── writes ─────────────────────────────────────────────────────────────────

type WriteArgs = Parameters<typeof publicClient.simulateContract>[0]

/// Simulate → send → wait. Callers get a mined transaction or a decodable revert, never a hash
/// whose outcome is still unknown: the approval flow in §4.3 has to confirm `approvePending`
/// succeeded *before* it tells the agent's session to retry.
async function send(functionName: string, args: readonly unknown[]): Promise<Hash> {
  const { request } = await publicClient.simulateContract({
    ...base,
    functionName,
    args,
    account: ownerAccount,
  } as unknown as WriteArgs)

  const hash = await ownerClient.writeContract(request as never)
  await publicClient.waitForTransactionReceipt({ hash })
  return hash
}

export const hireAgent = (agent: Address, perTxCap: bigint, perPeriodCap: bigint, role: string) =>
  send('hireAgent', [agent, perTxCap, perPeriodCap, role])

export const fundAgent = (agent: Address, amount: bigint) => send('fundAgent', [agent, amount])

export const defundAgent = (agent: Address, amount: bigint) => send('defundAgent', [agent, amount])

export const withdrawTreasury = (to: Address, amount: bigint) => send('withdrawTreasury', [to, amount])

export const updateCaps = (agent: Address, perTxCap: bigint, perPeriodCap: bigint) =>
  send('updateCaps', [agent, perTxCap, perPeriodCap])

export const revokeAgent = (agent: Address) => send('revokeAgent', [agent])

export const approvePending = (requestId: bigint) => send('approvePending', [requestId])

export const rejectPending = (requestId: bigint) => send('rejectPending', [requestId])
