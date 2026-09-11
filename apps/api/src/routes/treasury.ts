import { Hono } from 'hono'
import { z } from 'zod'
import * as contract from '../chain/roster.js'
import { ApiError } from '../http/errors.js'

/// The roster's balance: the one pool every agent spends from, within its own limits. Money goes
/// in with `deposit` (a plain transfer from the owner's wallet) and out with `withdraw`. There is
/// no per-agent allocation anywhere — DECISIONS.md 2026-09-11, "shared pool".

export const treasury = new Hono()

const amount = z
  .string()
  .regex(/^\d+$/, 'must be a whole number of USDC base units, as a string')
  .transform((v) => BigInt(v))
  .refine((v) => v > 0n, 'must be greater than zero')

async function parseAmount(c: { req: { json: () => Promise<unknown> } }): Promise<bigint> {
  let raw: unknown
  try {
    raw = await c.req.json()
  } catch {
    throw new ApiError(400, 'invalid_json', 'Request body must be JSON.')
  }

  const parsed = z.object({ amount }).safeParse(raw)
  if (!parsed.success) {
    throw new ApiError(400, 'invalid_body', parsed.error.issues.map((i) => i.message).join('; '))
  }
  return parsed.data.amount
}

async function snapshot() {
  const [balance, ownerBalance] = await Promise.all([contract.getBalance(), contract.getOwnerWalletBalance()])
  return {
    /// What the agents can spend from right now.
    balance: balance.toString(),
    /// What "add money" can move in. The owner's wallet, never shown as an address (§4.1).
    ownerBalance: ownerBalance.toString(),
  }
}

treasury.get('/', async (c) => c.json({ treasury: await snapshot() }))

/// "Add money". The check against the owner's wallet is only for a readable error — the token
/// transfer itself is what would refuse an overdraft.
treasury.post('/deposit', async (c) => {
  const value = await parseAmount(c)

  if ((await contract.getOwnerWalletBalance()) < value) {
    throw new ApiError(400, 'insufficient_owner_funds', "Your wallet doesn't hold that much USDC.")
  }

  const transactionHash = await contract.depositFromOwner(value)
  return c.json({ deposited: value.toString(), transactionHash, treasury: await snapshot() })
})

/// Always withdraws to the roster's owner. The API surface stays address-free (§4.1); sending
/// somewhere else is a deliberate on-chain action, not a dashboard button.
treasury.post('/withdraw', async (c) => {
  const value = await parseAmount(c)

  const owner = await contract.getOwner()
  const transactionHash = await contract.withdrawTreasury(owner, value)

  return c.json({ withdrawn: value.toString(), transactionHash, treasury: await snapshot() })
})
