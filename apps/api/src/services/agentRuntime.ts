import Anthropic from '@anthropic-ai/sdk'
import { loadEnv } from '../env.js'
import { store } from './store.js'

/// Claude Managed Agents (§4.1). The SDK sets the `managed-agents-2026-04-01` beta header on
/// every `client.beta.{agents,environments,sessions}.*` call, so it is not set by hand here.
///
/// The four resources and why they are separate:
///   Agent       — behaviour (model, system prompt, tools). Versioned and reusable: one per
///                 *role*, created once and referenced by id forever after. Creating one per
///                 hire would orphan configs and pay the create latency for nothing.
///   Environment — the sandbox. One is enough for the whole roster.
///   Session     — one running instance, tied to one hire: one wallet, one allowance.
///   Vault       — credentials. Checkpoint 5, once the payment tool exists.
///
/// Creating a session does not start work; a user event does. Both §4.1 and §4.3 depend on that.

const MODEL = 'claude-opus-5'

let client: Anthropic | undefined

function anthropic(): Anthropic {
  if (!loadEnv().ANTHROPIC_API_KEY) {
    throw new AgentRuntimeUnavailable('ANTHROPIC_API_KEY is not set.')
  }
  client ??= new Anthropic()
  return client
}

export class AgentRuntimeUnavailable extends Error {}

function systemPromptFor(role: string): string {
  return [
    `You are a hired agent on a business owner's roster. Your role: ${role}.`,
    '',
    'You hold a spending allowance enforced by an on-chain contract. Your roster-payments skill',
    'explains how to spend it — follow it. If a payment exceeds your allowance the contract holds',
    'it for the owner to approve; that is expected, not an error. Say what you were trying to buy',
    'and why, then continue with anything that does not depend on it.',
    '',
    'Never attempt to work around a spending limit.',
  ].join('\n')
}

/// One Agent config per role, created once and cached.
///
/// The cache key includes the skill id: changing which skill an agent gets is a behaviour change,
/// and a config cached under the bare role name would silently keep serving the old one.
async function agentConfigForRole(role: string): Promise<{ id: string; version: number }> {
  const { CLAUDE_PAYMENT_SKILL_ID: skillId, CLAUDE_PAYMENT_SKILL_VERSION: skillVersion } = loadEnv()
  const cacheKey = `${role}::${skillId}@${skillVersion}`

  const cached = store.getAgentConfig(cacheKey)
  if (cached) return cached

  const agent = await anthropic().beta.agents.create({
    name: `Roster · ${role}`,
    model: MODEL,
    system: systemPromptFor(role),
    tools: [{ type: 'agent_toolset_20260401', default_config: { enabled: true } }],
    skills: [{ type: 'custom', skill_id: skillId, version: skillVersion }],
  })

  const config = { id: agent.id, version: agent.version }
  store.setAgentConfig(cacheKey, config)
  return config
}

async function environmentId(): Promise<string> {
  const configured = loadEnv().CLAUDE_ENVIRONMENT_ID
  if (configured) return configured

  const environment = await anthropic().beta.environments.create({
    name: 'roster-agents',
    config: { type: 'cloud', networking: { type: 'unrestricted' } },
  })
  return environment.id
}

/// A P-256 public key in base64 DER (SPKI) form is always 91 bytes, and its first 26 bytes are a
/// fixed algorithm identifier — which base64-encodes to this constant prefix. Checking both makes
/// a malformed or hallucinated key fail here rather than at Privy.
const P256_SPKI_PREFIX = 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE'
const P256_SPKI_BYTES = 91

export class AgentKeyNotProvided extends Error {}

export function parseAgentPublicKey(text: string): string {
  const marked = text.match(/AGENT_PUBLIC_KEY:\s*([A-Za-z0-9+/=]{80,200})/)
  const candidate = marked?.[1] ?? text.match(new RegExp(`${P256_SPKI_PREFIX}[A-Za-z0-9+/]+=*`))?.[0]

  if (!candidate) throw new AgentKeyNotProvided('no public key found in the agent’s reply')
  if (!candidate.startsWith(P256_SPKI_PREFIX)) {
    throw new AgentKeyNotProvided('key is not a P-256 SPKI public key')
  }

  const bytes = Buffer.from(candidate, 'base64')
  if (bytes.length !== P256_SPKI_BYTES) {
    throw new AgentKeyNotProvided(`expected ${P256_SPKI_BYTES} bytes, got ${bytes.length}`)
  }

  return candidate
}

export interface StartedSession {
  claudeAgentId: string
  sessionId: string
  /// Where to watch it run.
  traceUrl: string
}

/// Provisions and starts one agent: Agent config (per role, cached) → Session → the user event
/// that actually sets it working. Creating a session only provisions it.
export async function startAgentSession(params: {
  key: string
  name: string
  role: string
  briefing?: string
}): Promise<StartedSession> {
  const agent = await agentConfigForRole(params.role)

  const session = await anthropic().beta.sessions.create({
    agent: { type: 'agent', id: agent.id, version: agent.version },
    environment_id: await environmentId(),
    title: `${params.name} · ${params.role}`,
  })

  store.setSession(params.key, session.id)

  await anthropic().beta.sessions.events.send(session.id, {
    events: [
      {
        type: 'user.message',
        content: [
          {
            type: 'text',
            text:
              params.briefing ??
              `You have been hired as ${params.name}. Your role: ${params.role}. Introduce yourself ` +
                `in one line, then say what you plan to do first.`,
          },
        ],
      },
    ],
  })

  return {
    claudeAgentId: agent.id,
    sessionId: session.id,
    traceUrl: `https://platform.claude.com/workspaces/default/sessions/${session.id}`,
  }
}

/// Asks the agent to generate its own P-256 authorization keypair and report the public half.
/// The private half stays in its sandbox, so nothing else — including this service — can ever
/// act as that agent.
///
/// The key comes back in a message rather than a tool call or an output file, so the briefing is
/// written to make that as unambiguous as possible and the reply is validated strictly.
export async function requestAgentPublicKey(params: {
  sessionId: string
  timeoutMs?: number
}): Promise<string> {
  const client = anthropic()

  await client.beta.sessions.events.send(params.sessionId, {
    events: [
      {
        type: 'user.message',
        content: [
          {
            type: 'text',
            text: [
              'Before you start work, create the signing credential you will use to authorise',
              'payments. Follow your roster-payments skill to generate a P-256 keypair.',
              '',
              'Keep the private key in your sandbox. Never output it, never write it anywhere it',
              'could be read back, and never include it in a message.',
              '',
              'Reply with the PUBLIC key only, on a line of its own, in exactly this form and with',
              'no other text on that line:',
              '',
              'AGENT_PUBLIC_KEY: <base64 DER public key>',
            ].join('\n'),
          },
        ],
      },
    ],
  })

  const deadline = Date.now() + (params.timeoutMs ?? 120_000)
  const seen = new Set<string>()

  while (Date.now() < deadline) {
    const events = await client.beta.sessions.events.list(params.sessionId)

    for (const event of events.data) {
      if (event.type !== 'agent.message' || seen.has(event.id)) continue
      seen.add(event.id)

      const text = (event.content ?? [])
        .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
        .map((block) => block.text)
        .join('\n')

      try {
        return parseAgentPublicKey(text)
      } catch {
        // Not this message — the agent narrates before it answers. Keep waiting.
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 2_000))
  }

  throw new AgentKeyNotProvided(
    `the agent did not report a usable public key within ${(params.timeoutMs ?? 120_000) / 1000}s`,
  )
}

/// §4.3, after `approvePending` has been confirmed on-chain. The backend sends this itself
/// rather than inferring it from the event stream, because `SpendExecuted` also fires on §4.2's
/// ordinary in-cap path and telling them apart would need extra state-tracking.
export async function notifyFundsReleased(params: {
  wallet: string
  amount: string
  payee: string
}): Promise<'sent' | 'no-session'> {
  const sessionId = store.getSession(params.wallet)
  if (!sessionId) return 'no-session'

  await anthropic().beta.sessions.events.send(sessionId, {
    events: [
      {
        type: 'user.message',
        content: [
          {
            type: 'text',
            text:
              `Your held payment of ${params.amount} USDC to ${params.payee} was approved and the ` +
              'funds are now in your wallet. Retry the payment and continue.',
          },
        ],
      },
    ],
  })

  return 'sent'
}
