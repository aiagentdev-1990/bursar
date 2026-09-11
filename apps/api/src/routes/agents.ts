import { Hono } from 'hono'
import { z } from 'zod'
import { stringToHex, type Address } from 'viem'
import * as contract from '../chain/roster.js'
import { fetchRosterEvents, agentAddressesFrom, openRequestsFrom } from '../services/blockscout.js'
import { encodeLabel, decodeLabel, InvalidLabelError } from '../services/labels.js'
import { findByAgentId, agentId } from '../services/ids.js'
import { toAgentView, toActivityView, toHireView } from '../services/view.js'
import { walletProvider } from '../services/wallets.js'
import { runtimeAvailable } from '../services/agentRuntime.js'
import { hireJobs } from '../services/hiring.js'
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
  /// The agent's first task, sent once it is on the roster.
  briefing: z.string().min(1).max(4000).optional(),
})

const capsBody = z.object({ perTxCap: baseUnits, perPeriodCap: baseUnits })

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
//
// With a Claude runtime, a hire waits minutes on the agent setting itself up, so it runs as a
// background job (services/hires.ts) and this answers 202 at once with the hire. Its progress is
// at GET /agents/hires; the agent joins GET /agents once it is registered on-chain. If the agent
// never reports a wallet, the hire fails with nothing registered.

agents.post('/', async (c) => {
  const body = await parse(c, hireBody)

  let role: string
  try {
    role = encodeLabel({ name: body.name, role: body.role })
  } catch (error) {
    if (error instanceof InvalidLabelError) throw new ApiError(400, 'invalid_label', error.message)
    throw error
  }

  if (runtimeAvailable()) {
    const { hire } = hireJobs.start({
      name: body.name,
      role: body.role,
      perTxCap: body.perTxCap,
      perPeriodCap: body.perPeriodCap,
      briefing: body.briefing,
    })
    return c.json({ hire: toHireView(hire) }, 202)
  }

  // No Claude runtime (development, the integration tests): there is nothing to wait on, so a
  // local dev wallet is hired synchronously and the on-chain half can still be exercised. Nothing
  // runs as this agent, and the response says so.
  const wallet = await walletProvider().createAgentWallet(body.name)
  const warning =
    'No Claude session started (ANTHROPIC_API_KEY is not set), so a local dev wallet was used and nothing is running as this agent.'

  const remember = () =>
    store.putAgent({
      wallet,
      name: body.name,
      role: body.role,
      perTxCap: body.perTxCap.toString(),
      perPeriodCap: body.perPeriodCap.toString(),
      createdAt: new Date().toISOString(),
    })

  // Provisioning-only mode: no ROSTER_CONTRACT_ADDRESS, so nothing is registered on-chain and
  // NO CAP IS ENFORCED ANYWHERE. Scaffolding, not a supported mode — the response says so.
  if (!contractEnabled()) {
    remember()
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
        started: false,
        warning: `Provisioning-only mode: no ROSTER_CONTRACT_ADDRESS is set, so these caps are recorded but not enforced. Nothing stops this agent spending. ${warning}`,
      },
      201,
    )
  }

  await contract.hireAgent(wallet, body.perTxCap, body.perPeriodCap, role)
  remember()

  const info = await contract.getAgent(wallet)
  return c.json({ agent: toAgentView(wallet, info, { hasOpenRequest: false }), started: false, warning }, 201)
})

// ─── hires in flight ────────────────────────────────────────────────────────
// Registered before /:id, which would otherwise read "hires" as an agent id.

agents.get('/hires', (c) => c.json({ hires: store.listHires().map(toHireView) }))

agents.get('/hires/:hireId', (c) => {
  const hire = store.getHire(c.req.param('hireId'))
  if (!hire) throw new ApiError(404, 'unknown_hire', 'There is no hire with that id.')
  return c.json({ hire: toHireView(hire) })
})

/// Clears a finished hire — a failure the owner has read, or one that went through. A hire still
/// running can't be cleared: its job would keep writing to it.
agents.delete('/hires/:hireId', (c) => {
  const hire = store.getHire(c.req.param('hireId'))
  if (!hire) throw new ApiError(404, 'unknown_hire', 'There is no hire with that id.')
  if (hire.status !== 'failed' && hire.status !== 'active') {
    throw new ApiError(409, 'hire_in_progress', 'That hire is still in progress.')
  }
  store.deleteHire(hire.id)
  return c.json({ deleted: true })
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
    'Recurring top-ups need Bridge Kit (checkpoint 10), which is not wired yet. Add money with POST /treasury/deposit.',
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
