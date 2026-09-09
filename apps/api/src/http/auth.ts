import { createMiddleware } from 'hono/factory'
import { ApiError } from './errors.js'
import { loadEnv } from '../env.js'

/// Every endpoint in §6 is owner-authenticated. Agents never call this service — an agent's
/// payment tool talks to the contract and the x402 facilitator directly with its own wallet.
///
/// Checkpoint 3 replaces the shared bearer token with verification of a Privy access token.
/// The middleware boundary stays the same; only the check inside it changes.
export const requireOwner = createMiddleware(async (c, next) => {
  const header = c.req.header('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''

  if (!token || !timingSafeEqual(token, loadEnv().OWNER_API_TOKEN)) {
    throw new ApiError(401, 'unauthorized', 'Owner authentication required.')
  }

  await next()
})

/// Constant-time compare so the token can't be recovered a byte at a time.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
