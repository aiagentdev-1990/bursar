import Anthropic from '@anthropic-ai/sdk'
import { getAddress, isAddress, type Address } from 'viem'
import { loadEnv } from '../env.js'
import { store } from './store.js'

/// Claude Managed Agents (§4.1). The SDK sets the `managed-agents-2026-04-01` beta header on
/// every `client.beta.{agents,environments,sessions}.*` call, so it is not set by hand here.
///
/// The resources and why they are separate:
///   Agent       — behaviour: model, system prompt, tools, and the payment skill. One per hire,
///                 created before its session, so each carries its own name and role and stays
///                 pinned to the skill version it was hired with.
///   Environment — the sandbox. One is enough for the whole roster.
///   Session     — one running instance of that agent: one wallet, one allowance.
///
/// The agent's wallet is created by its skill, inside its own sandbox. This service never sees
/// the key — only the address the agent reports, which is what gets hired on-chain.

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

function systemPromptFor(name: string, role: string): string {
  return [
    `You are ${name}, a hired agent on a business owner's roster. Your role: ${role}.`,
    '',
    'You hold a spending allowance enforced by an on-chain contract. Your payment skill explains',
    'how to set up and how to spend it — follow it. If a payment exceeds your allowance the',
    'contract holds it for the owner to approve; that is expected, not an error. Say what you were',
    'trying to buy and why, then continue with anything that does not depend on it.',
    '',
    'Never attempt to work around a spending limit.',
  ].join('\n')
}

/// A new Agent for this hire, with the payment skill attached. Created before the session, which
/// has to reference it. Pinned to the configured skill version, so a later upload cannot change
/// how an agent already on the roster pays.
async function createAgent(params: { name: string; role: string }): Promise<{ id: string; version: number }> {
  const { CLAUDE_PAYMENT_SKILL_ID: skillId, CLAUDE_PAYMENT_SKILL_VERSION: skillVersion } = loadEnv()

  const agent = await anthropic().beta.agents.create({
    name: `Roster · ${params.name}`,
    model: MODEL,
    system: systemPromptFor(params.name, params.role),
    tools: [{ type: 'agent_toolset_20260401', default_config: { enabled: true } }],
    skills: [{ type: 'custom', skill_id: skillId, version: skillVersion }],
  })

  return { id: agent.id, version: agent.version }
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

/// Creates a new Agent for this hire, then a session on it that opens with `briefing`. Passing it
/// as `initial_events` collapses create + first message: the session starts already running.
export async function startAgentSession(params: {
  name: string
  role: string
  briefing: string
}): Promise<StartedSession> {
  const agent = await createAgent(params)

  const session = await anthropic().beta.sessions.create({
    agent: { type: 'agent', id: agent.id, version: agent.version },
    environment_id: await environmentId(),
    title: `${params.name} · ${params.role}`,
    initial_events: [{ type: 'user.message', content: [{ type: 'text', text: params.briefing }] }],
  })

  return {
    claudeAgentId: agent.id,
    sessionId: session.id,
    traceUrl: `https://platform.claude.com/workspaces/default/sessions/${session.id}`,
  }
}

export async function sendMessage(sessionId: string, text: string): Promise<void> {
  await anthropic().beta.sessions.events.send(sessionId, {
    events: [{ type: 'user.message', content: [{ type: 'text', text }] }],
  })
}

// ─── the wallet the agent's skill creates ───────────────────────────────────

export class AgentSetupFailed extends Error {}

const WALLET_LINE = /WALLET_ADDRESS:\s*(0x[0-9a-fA-F]{40})\b/g

/// The address from the agent's `WALLET_ADDRESS: 0x…` line, checksummed. Strict on purpose: this
/// is the address that gets an allowance, so an ambiguous or malformed one fails here — before
/// anything is registered — rather than on-chain.
export function parseWalletAddress(text: string): Address {
  const found = [...text.matchAll(WALLET_LINE)].map((match) => {
    // `isAddress` is strict by default: a mixed-case address must carry a valid EIP-55 checksum.
    // That catches an agent retyping its address with a typo — `getAddress` alone would just
    // re-checksum the typo and fund the wrong wallet.
    if (!isAddress(match[1]!)) throw new AgentSetupFailed(`the agent reported an invalid address (${match[1]})`)
    return getAddress(match[1]!)
  })
  if (found.length === 0) throw new AgentSetupFailed('no WALLET_ADDRESS line in the agent’s reply')
  if (new Set(found).size > 1) throw new AgentSetupFailed('the agent reported more than one wallet address')
  return found[0]!
}

const textOf = (content: Array<{ type: string }> | undefined): string =>
  (content ?? [])
    .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
    .map((block) => block.text)
    .join('\n')

/// Waits for the agent to run its skill's setup and report its wallet. Setup installs packages
/// in the sandbox, so this takes a minute or two.
export async function waitForWalletAddress(sessionId: string, timeoutMs = 240_000): Promise<Address> {
  const client = anthropic()
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    let replied = false
    for await (const event of client.beta.sessions.events.list(sessionId)) {
      if (event.type !== 'agent.message') continue
      replied = true
      const text = textOf(event.content)
      if (text.match(WALLET_LINE)) return parseWalletAddress(text)
    }

    const { status } = await client.beta.sessions.retrieve(sessionId)
    if (status === 'terminated') throw new AgentSetupFailed('the session ended before the agent reported a wallet')
    // Idle after replying means its turn is over — it will not report an address on its own.
    if (status === 'idle' && replied) throw new AgentSetupFailed('the agent finished its setup turn without reporting a wallet')

    await new Promise((resolve) => setTimeout(resolve, 3_000))
  }

  throw new AgentSetupFailed(`the agent did not report a wallet within ${timeoutMs / 1000}s`)
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
