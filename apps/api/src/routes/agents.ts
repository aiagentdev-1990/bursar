import { Hono } from 'hono'
import { z } from 'zod'
import { formatUnits, stringToHex, type Address } from 'viem'
import * as contract from '../chain/roster.js'
import { fetchRosterEvents, agentAddressesFrom, openRequestsFrom } from '../services/blockscout.js'
import { encodeLabel, decodeLabel, InvalidLabelError } from '../services/labels.js'
import { findByAgentId, agentId } from '../services/ids.js'
import { toAgentView, toActivityView } from '../services/view.js'
import { walletProvider } from '../services/wallets.js'
import {
  startAgentSession,
  sendMessage,
  waitForWalletAddress,
  AgentRuntimeUnavailable,
  AgentSetupFailed,
  type StartedSession,
} from '../services/agentRuntime.js'
import { contractEnabled, ROSTER_ADDRESS } from '../chain/chain.js'
import { loadEnv } from '../env.js'
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
  /// The agent's first task, sent once it is on the roster.
  briefing: z.string().min(1).max(4000).optional(),
})

type HireBody = z.infer<typeof hireBody>

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
//
//   1. A new Claude agent with the payment skill, then a session on it.
//   2. The skill's setup creates the agent's wallet in its own sandbox; the agent reports only the
//      address. The key never leaves the sandbox and this service never sees it.
//   3. That address is hired on-chain with its caps, and funded.
//   4. The agent is told where its allowance lives — the Roster and the relay — and its task.
//
// Takes a minute or two, because step 2 waits on the agent. If the agent never reports a wallet,
// nothing is registered on-chain.

const usd = (v: bigint): string => `$${formatUnits(v, 6)}`

function setupBriefing(body: HireBody): string {
  return [
    `You have been hired as ${body.name}. Your role: ${body.role}.`,
    '',
    'Before anything else, run the setup in your payment skill and report your wallet address on a',
    'line of its own, exactly as the skill shows:',
    '',
    'WALLET_ADDRESS: 0x...',
    '',
    'Buy nothing yet. You are not on the roster until you are told so.',
  ].join('\n')
}

function onRosterBriefing(body: HireBody, relayUrl: string | undefined): string {
  return [
    'You are on the roster. Save these as your skill says:',
    '',
    `Roster contract: ${ROSTER_ADDRESS}`,
    relayUrl
      ? `Relay URL: ${relayUrl}`
      : 'Relay URL: not configured yet. Do not try to buy anything until you are given one.',
    '',
    `Your caps: ${usd(body.perTxCap)} per transaction, ${usd(body.perPeriodCap)} per 30 days. Anything`,
    'above either is held for your owner to decide.',
    '',
    body.briefing ?? 'Introduce yourself in one line, then say what you plan to do first.',
  ].join('\n')
}

/// Steps 1–2, shared by both modes. Without a Claude runtime (development, the integration
/// tests), falls back to a local dev wallet so the on-chain half can still be exercised — nothing
/// runs as that agent, and the response says so.
async function provision(body: HireBody): Promise<{ wallet: Address; started?: StartedSession; warning?: string }> {
  let started: StartedSession
  try {
    started = await startAgentSession({ name: body.name, role: body.role, briefing: setupBriefing(body) })
  } catch (error) {
    if (!(error instanceof AgentRuntimeUnavailable)) throw error
    return {
      wallet: await walletProvider().createAgentWallet(body.name),
      warning: `No Claude session started (${error.message}), so a local dev wallet was used and nothing is running as this agent.`,
    }
  }

  try {
    return { wallet: await waitForWalletAddress(started.sessionId), started }
  } catch (error) {
    if (error instanceof AgentSetupFailed) {
      throw new ApiError(
        502,
        'agent_setup_failed',
        `The agent did not finish setting up: ${error.message}. Nothing was registered on-chain. Session: ${started.traceUrl}`,
      )
    }
    throw error
  }
}

agents.post('/', async (c) => {
  const body = await parse(c, hireBody)

  let role: string
  try {
    role = encodeLabel({ name: body.name, role: body.role })
  } catch (error) {
    if (error instanceof InvalidLabelError) throw new ApiError(400, 'invalid_label', error.message)
    throw error
  }

  const { wallet, started, warning } = await provision(body)
  const warnings = warning ? [warning] : []

  const remember = () =>
    store.putAgent({
      wallet,
      name: body.name,
      role: body.role,
      perTxCap: body.perTxCap.toString(),
      perPeriodCap: body.perPeriodCap.toString(),
      claudeAgentId: started?.claudeAgentId,
      sessionId: started?.sessionId,
      createdAt: new Date().toISOString(),
    })
  if (started) store.setSession(wallet, started.sessionId)

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
        started: started !== undefined,
        ...(started ? { session: started } : {}),
        warning: [
          'Provisioning-only mode: no ROSTER_CONTRACT_ADDRESS is set, so these caps are recorded but',
          'not enforced. Nothing stops this agent spending.',
          ...warnings,
        ].join(' '),
      },
      201,
    )
  }

  // 3. Registration. From here the caps are live and enforced.
  await contract.hireAgent(wallet, body.perTxCap, body.perPeriodCap, role)
  if (body.fundAmount) await contract.fundAgent(wallet, body.fundAmount)
  remember()

  // 4. Only now does the agent learn where its allowance lives — it cannot spend before it is
  //    registered, and it is told not to try.
  if (started) {
    const relayUrl = loadEnv().RELAY_PUBLIC_URL
    if (!relayUrl) warnings.push('RELAY_PUBLIC_URL is not set, so the agent has no relay and cannot spend yet.')
    await sendMessage(started.sessionId, onRosterBriefing(body, relayUrl))
  }

  const info = await contract.getAgent(wallet)

  return c.json(
    {
      agent: toAgentView(wallet, info, { hasOpenRequest: false }),
      started: started !== undefined,
      ...(started ? { session: started } : {}),
      ...(warnings.length > 0 ? { warning: warnings.join(' ') } : {}),
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
