import { Hono } from 'hono'
import { z } from 'zod'
import * as contract from '../chain/roster.js'
import { contractEnabled, relayerAccount } from '../chain/chain.js'
import { ApiError } from '../http/errors.js'

/// The relay for `executeSpendFor` (DECISIONS.md 2026-09-11). Agents hold no gas, so they sign a
/// spend request and this submits it, paying the gas with the relayer key.
///
/// Deliberately **unauthenticated** — the one route an agent calls, and the exception to §6's
/// "owner-authenticated only". The agent's EIP-712 signature is the authorization, and the
/// contract is what verifies it. This route checks no cap, no signature and no membership: every
/// one of those is the contract's job, and a check here would be a second, weaker one.
///
/// Every submission is simulated first, so a bad signature, a revoked agent or an expired
/// request is refused with the contract's own error and costs no gas.
///
/// Known gap: a registered agent can make the relayer pay gas for as many over-cap requests as it
/// likes — held requests consume no budget. Bounded by the relayer's balance; rate-limit here if
/// it ever matters.

export const relay = new Hono()

const address = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, 'must be a 0x-prefixed 20-byte address')
  .transform((v) => v as `0x${string}`)

const hex = z
  .string()
  .regex(/^0x([0-9a-fA-F]{2})*$/, 'must be 0x-prefixed hex')
  .transform((v) => v as `0x${string}`)

/// Base units and timestamps arrive as decimal strings — JSON numbers would round them.
const uint = z
  .string()
  .regex(/^\d+$/, 'must be a whole number, as a string')
  .transform((v) => BigInt(v))

const spendBody = z.object({
  agent: address,
  amount: uint,
  payee: address,
  memo: hex,
  deadline: uint,
  signature: hex,
})

relay.post('/spend', async (c) => {
  if (!contractEnabled() || !relayerAccount) {
    throw new ApiError(501, 'relay_not_configured', 'This roster has no relayer, so signed spends cannot be submitted.')
  }

  let raw: unknown
  try {
    raw = await c.req.json()
  } catch {
    throw new ApiError(400, 'invalid_json', 'Request body must be JSON.')
  }

  const parsed = spendBody.safeParse(raw)
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ')
    throw new ApiError(400, 'invalid_body', detail)
  }

  const result = await contract.relaySpend(parsed.data)

  return c.json({
    executed: result.executed,
    ...(result.requestId !== undefined ? { requestId: result.requestId.toString() } : {}),
    transactionHash: result.transactionHash,
  })
})
