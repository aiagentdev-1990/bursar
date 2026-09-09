import { Hono } from 'hono'
import { z } from 'zod'
import * as contract from '../chain/roster.js'
import { ApiError } from '../http/errors.js'

/// The Roster's own USDC balance, and the way unallocated funds get back out. §4.6 delivers to
/// the Roster address, so without a withdrawal path an over-delivery is stuck there forever.

export const treasury = new Hono()

const amount = z
  .string()
  .regex(/^\d+$/, 'must be a whole number of USDC base units, as a string')
  .transform((v) => BigInt(v))
  .refine((v) => v > 0n, 'must be greater than zero')

treasury.get('/', async (c) => {
  const [earmarked, unallocated] = await Promise.all([
    contract.getTotalEarmarked(),
    contract.getUnallocatedTreasury(),
  ])

  return c.json({
    treasury: {
      earmarked: earmarked.toString(),
      /// Headroom for fundAgent, and the ceiling on a withdrawal.
      unallocated: unallocated.toString(),
      balance: (earmarked + unallocated).toString(),
    },
  })
})

/// Always withdraws to the roster's owner. The API surface stays address-free (§4.1); sending
/// somewhere else is a deliberate on-chain action, not a dashboard button.
treasury.post('/withdraw', async (c) => {
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

  const owner = await contract.getOwner()
  const transactionHash = await contract.withdrawTreasury(owner, parsed.data.amount)

  return c.json({
    withdrawn: parsed.data.amount.toString(),
    transactionHash,
    unallocated: (await contract.getUnallocatedTreasury()).toString(),
  })
})
