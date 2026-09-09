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

/// Provisions and starts one agent. Returns the session id, which is stored against the agent's
/// wallet so §4.3 can resume it after an approval.
export async function startAgentSession(params: {
  wallet: string
  name: string
  role: string
}): Promise<string> {
  const agent = await agentConfigForRole(params.role)

  const session = await anthropic().beta.sessions.create({
    agent: { type: 'agent', id: agent.id, version: agent.version },
    environment_id: await environmentId(),
    title: `${params.name} · ${params.role}`,
  })

  store.setSession(params.wallet, session.id)

  // Creating the session only provisions it. This is what actually starts the agent working.
  await anthropic().beta.sessions.events.send(session.id, {
    events: [
      {
        type: 'user.message',
        content: [
          {
            type: 'text',
            text: `You have been hired as ${params.name}. Begin your work: ${params.role}.`,
          },
        ],
      },
    ],
  })

  return session.id
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
