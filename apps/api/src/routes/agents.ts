import { Hono } from 'hono'
import { z } from 'zod'
import { stringToHex, type Address } from 'viem'
import * as contract from '../chain/roster.js'
import { fetchRosterEvents, agentAddressesFrom, openRequestsFrom } from '../services/blockscout.js'
import { encodeLabel, decodeLabel, InvalidLabelError } from '../services/labels.js'
import { findByAgentId, agentId } from '../services/ids.js'
import { toAgentView, toActivityView } from '../services/view.js'
import { walletProvider } from '../services/wallets.js'
import { startAgentSession, AgentRuntimeUnavailable } from '../services/agentRuntime.js'
import { contractEnabled } from '../chain/chain.js'
import { store } from '../services/store.js'
import { ApiError } from '../http/errors.js'

/// §6. Owner-authenticated (mounted behind requireOwner). Agents never call these — an agent's
/// payment tool talks to the contract and the x402 facilitator directly with its own wallet.

export const agents = new Hono()

/// Caps arrive as base-unit decimal strings, matching the contract. See services/view.ts.
const baseUnits = z
  .string()
  .regex(/^\d+$/, 'must be a whole number of USDC base units, as a string')
  .transform((v) => BigInt(v))
  .refine((v) => v > 0n, 'must be greater than zero')

const hireBody = z.object({
  name: z.string().min(1).max(60),
  role: z.string().min(1).max(200),
  perTxCap: baseUnits,
  perPeriodCap: baseUnits,
  /// Optional opening earmark. Requires the Roster to already hold this much USDC (§4.6).
  fundAmount: baseUnits.optional(),
})

const capsBody = z.object({ perTxCap: baseUnits, perPeriodCap: baseUnits })
const fundBody = z.object({ amount: baseUnits })

async function parse<T extends z.ZodTypeAny>(c: { req: { json: () => Promise<unknown> } }, schema: T): Promise<z.infer<T>> {
  let raw: unknown
  try {
    raw = await c.req.json()
  } catch {
    throw new ApiError(400, 'invalid_json', 'Request body must be JSON.')
  }

  const result = schema.safeParse(raw)
  if (!result.success) {
    const detail = result.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ')
    throw new ApiError(400, 'invalid_body', detail)
  }
  return result.data
}

/// The roster, assembled from the two sources §4.5 splits between: membership and history from
/// the event log, live per-agent state from the contract.
async function loadRoster() {
  const events = await fetchRosterEvents()
  const addresses = agentAddressesFrom(events)
  const infos = await contract.getAgents(addresses)
  const open = openRequestsFrom(events)

  const lastActivity = new Map<string, string>()
  for (const event of events) {
    const agent = event.args.agent as Address | undefined
    // Events come back newest first, so the first one seen for an agent is its latest.
    if (agent && event.timestamp && !lastActivity.has(agent.toLowerCase())) {
      lastActivity.set(agent.toLowerCase(), event.timestamp)
    }
  }

  const pendingBy = new Set(open.map((r) => r.agent.toLowerCase()))

  return { events, addresses, infos, open, lastActivity, pendingBy }
}

function requireAddress(addresses: Address[], id: string): Address {
  const address = findByAgentId(addresses, id)
  if (!address) throw new ApiError(404, 'unknown_agent', 'That agent is not on this roster.')
  return address
}

// ─── GET /agents ────────────────────────────────────────────────────────────

agents.get('/', async (c) => {
  if (!contractEnabled()) {
    return c.json({
      agents: store.listAgents().map((a) => ({
        id: agentId(a.wallet as `0x${string}`),
        name: a.name,
        role: a.role,
        perTxCap: a.perTxCap,
        perPeriodCap: a.perPeriodCap,
        status: 'active' as const,
        sessionId: a.sessionId,
      })),
      warning: 'Provisioning-only mode: caps shown are not enforced.',
    })
  }

  const { addresses, infos, lastActivity, pendingBy } = await loadRoster()

  const roster = addresses
    .map((address) => {
      const info = infos.get(address)
      if (!info) return undefined
      return toAgentView(address, info, {
        hasOpenRequest: pendingBy.has(address.toLowerCase()),
        lastActivityAt: lastActivity.get(address.toLowerCase()),
      })
    })
    .filter((view): view is NonNullable<typeof view> => view !== undefined)

  return c.json({ agents: roster })
})

// ─── POST /agents — the §4.1 hire flow ──────────────────────────────────────

agents.post('/', async (c) => {
  const body = await parse(c, hireBody)

  // Provisioning-only mode: no ROSTER_CONTRACT_ADDRESS, so nothing is registered on-chain and
  // NO CAP IS ENFORCED ANYWHERE. Scaffolding for building the onboarding flow ahead of the
  // contract — the response says so, rather than implying an allowance that does not exist.
  if (!contractEnabled()) {
    const wallet = await walletProvider().createAgentWallet(body.name)

    const started = await startAgentSession({ key: wallet, name: body.name, role: body.role })

    store.putAgent({
      wallet,
      name: body.name,
      role: body.role,
      perTxCap: body.perTxCap.toString(),
      perPeriodCap: body.perPeriodCap.toString(),
      claudeAgentId: started.claudeAgentId,
      sessionId: started.sessionId,
      createdAt: new Date().toISOString(),
    })

    return c.json(
      {
        agent: {
          id: agentId(wallet),
          name: body.name,
          role: body.role,
          perTxCap: body.perTxCap.toString(),
          perPeriodCap: body.perPeriodCap.toString(),
          status: 'active' as const,
        },
        started: true,
        session: started,
        warning:
          'Provisioning-only mode: no ROSTER_CONTRACT_ADDRESS is set, so these caps are recorded ' +
          'but not enforced. Nothing stops this agent spending.',
      },
      201,
    )
  }

  let role: string
  try {
    role = encodeLabel({ name: body.name, role: body.role })
  } catch (error) {
    if (error instanceof InvalidLabelError) throw new ApiError(400, 'invalid_label', error.message)
    throw error
  }

  // 1. Wallet first — the owner never handles a key and never sees the address.
  const wallet = await walletProvider().createAgentWallet(body.name)

  // 2. Registration. From here the caps are live and enforced; everything after this point is
  //    provisioning, and a failure there leaves an agent that is registered but not yet running
  //    rather than one that is running without limits.
  await contract.hireAgent(wallet, body.perTxCap, body.perPeriodCap, role)

  if (body.fundAmount) {
    await contract.fundAgent(wallet, body.fundAmount)
  }

  // 3. Claude Agent config, Environment, Session, then the user event that starts it working.
  let started: Awaited<ReturnType<typeof startAgentSession>> | undefined
  let runtimeWarning: string | undefined
  try {
    started = await startAgentSession({ key: wallet, name: body.name, role: body.role })
  } catch (error) {
    if (error instanceof AgentRuntimeUnavailable) {
      runtimeWarning = `Agent is on the roster and its caps are enforced, but no Claude session started: ${error.message}`
    } else {
      throw error
    }
  }

  const info = await contract.getAgent(wallet)

  return c.json(
    {
      agent: toAgentView(wallet, info, { hasOpenRequest: false }),
      started: started !== undefined,
      ...(started ? { session: started } : {}),
      ...(runtimeWarning ? { warning: runtimeWarning } : {}),
    },
    201,
  )
})

// ─── GET /agents/:id ────────────────────────────────────────────────────────

agents.get('/:id', async (c) => {
  const { addresses, infos, lastActivity, pendingBy } = await loadRoster()
  const address = requireAddress(addresses, c.req.param('id'))
  const info = infos.get(address)!

  return c.json({
    agent: toAgentView(address, info, {
      hasOpenRequest: pendingBy.has(address.toLowerCase()),
      lastActivityAt: lastActivity.get(address.toLowerCase()),
    }),
  })
})

// ─── PATCH /agents/:id/caps ─────────────────────────────────────────────────

agents.patch('/:id/caps', async (c) => {
  const body = await parse(c, capsBody)
  const { addresses } = await loadRoster()
  const address = requireAddress(addresses, c.req.param('id'))

  await contract.updateCaps(address, body.perTxCap, body.perPeriodCap)

  const info = await contract.getAgent(address)
  return c.json({ agent: toAgentView(address, info, { hasOpenRequest: false }) })
})

// ─── POST /agents/:id/revoke (§4.4) ─────────────────────────────────────────

agents.post('/:id/revoke', async (c) => {
  const { addresses } = await loadRoster()
  const address = requireAddress(addresses, c.req.param('id'))

  await contract.revokeAgent(address)

  const info = await contract.getAgent(address)
  return c.json({ agent: toAgentView(address, info, { hasOpenRequest: false }) })
})

// ─── POST /agents/:id/fund (§4.6) ───────────────────────────────────────────
// Not in §6's table, which only lists the recurring schedule. Added because §4.6's one-off half
// has to be reachable to fund the demo at all, and it maps straight onto §5's `fundAgent`.

agents.post('/:id/fund', async (c) => {
  const body = await parse(c, fundBody)
  const { addresses } = await loadRoster()
  const address = requireAddress(addresses, c.req.param('id'))

  await contract.fundAgent(address, body.amount)

  const info = await contract.getAgent(address)
  return c.json({ agent: toAgentView(address, info, { hasOpenRequest: false }) })
})

// ─── POST /agents/:id/defund ────────────────────────────────────────────────
// The counterpart to fund. Without it, revoking a funded agent stranded its remaining budget.

agents.post('/:id/defund', async (c) => {
  const body = await parse(c, fundBody)
  const { addresses } = await loadRoster()
  const address = requireAddress(addresses, c.req.param('id'))

  await contract.defundAgent(address, body.amount)

  const info = await contract.getAgent(address)
  return c.json({ agent: toAgentView(address, info, { hasOpenRequest: false }) })
})

// ─── GET /agents/:id/activity (§4.5) ────────────────────────────────────────

agents.get('/:id/activity', async (c) => {
  const { events, addresses, infos } = await loadRoster()
  const address = requireAddress(addresses, c.req.param('id'))

  const nameFor = nameLookup(infos)
  const activity = events
    .filter((e) => (e.args.agent as Address | undefined)?.toLowerCase() === address.toLowerCase())
    .map((event) => toActivityView(event, nameFor))

  return c.json({ activity })
})

// ─── POST /agents/:id/funding-schedule (§4.6, checkpoint 10) ────────────────

agents.post('/:id/funding-schedule', () => {
  throw new ApiError(
    501,
    'bridge_kit_not_wired',
    'Recurring top-ups need Bridge Kit (checkpoint 10), which is not wired yet. Use POST /agents/:id/fund.',
  )
})

export function nameLookup(infos: Map<Address, contract.AgentInfo>) {
  const byAddress = new Map<string, string>()
  for (const [address, info] of infos) {
    byAddress.set(address.toLowerCase(), decodeLabel(info.role).name)
  }
  return (address: Address) => byAddress.get(address.toLowerCase())
}

/// Exported for the listener, which needs the same encoding when it logs a held request.
export const encodeMemo = (text: string) => stringToHex(text)
