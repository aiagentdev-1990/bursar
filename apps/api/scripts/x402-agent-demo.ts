// End-to-end check: a Claude Managed Agent with the x402-arc skill discovers a paid endpoint and
// buys data over x402 on Arc testnet, from a wallet it generated itself.
//
//   npx tsx scripts/x402-agent-demo.ts <skill_id> <catalog_url>
//
// Flow: create agent (skill attached) -> session -> agent sets up its wallet and reports the
// address -> we fund it from OWNER_PRIVATE_KEY -> agent reads the catalog and pays -> we verify the
// spend on-chain.

import { resolve } from 'node:path'
import { config } from 'dotenv'
import Anthropic from '@anthropic-ai/sdk'
import { createPublicClient, createWalletClient, erc20Abi, formatUnits, http } from 'viem'
import { arcTestnet } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'

config({ path: resolve(import.meta.dirname, '../../../.env') })

const [skillId, catalogUrl] = process.argv.slice(2)
if (!skillId || !catalogUrl) {
  console.error('usage: tsx scripts/x402-agent-demo.ts <skill_id> <catalog_url>')
  process.exit(1)
}

const USDC = '0x3600000000000000000000000000000000000000' as const
const FUND = 50_000n // $0.05 in base units
const rawKey = process.env.OWNER_PRIVATE_KEY?.trim()
if (!rawKey) throw new Error('OWNER_PRIVATE_KEY is not set')
const owner = privateKeyToAccount((rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`) as `0x${string}`)

const anthropic = new Anthropic()
const chain = createPublicClient({ chain: arcTestnet, transport: http() })
const wallet = createWalletClient({ account: owner, chain: arcTestnet, transport: http() })

type AgentMessage = { id: string; text: string }

async function agentMessages(sessionId: string): Promise<AgentMessage[]> {
  const out: AgentMessage[] = []
  for await (const event of anthropic.beta.sessions.events.list(sessionId)) {
    if (event.type !== 'agent.message') continue
    const text = (event.content ?? [])
      .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
    out.push({ id: event.id, text })
  }
  return out
}

async function send(sessionId: string, text: string): Promise<void> {
  await anthropic.beta.sessions.events.send(sessionId, {
    events: [{ type: 'user.message', content: [{ type: 'text', text }] }],
  })
}

/// Waits until the agent has replied after `before` messages and the session has gone idle.
async function waitForReply(sessionId: string, before: number, timeoutMs = 420_000): Promise<AgentMessage[]> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5_000))
    const { status } = await anthropic.beta.sessions.retrieve(sessionId)
    const messages = await agentMessages(sessionId)
    if (messages.length > before && (status === 'idle' || status === 'terminated')) {
      return messages.slice(before)
    }
  }
  throw new Error(`no reply within ${timeoutMs / 1000}s`)
}

const usdcOf = async (address: `0x${string}`) =>
  chain.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [address] })

// 1. Agent config with the skill attached.
const agent = await anthropic.beta.agents.create({
  name: 'Roster · x402 demo',
  model: 'claude-opus-5',
  system:
    'You are a research agent for a luxury watch reseller. When you need paid data, use your ' +
    'x402-arc skill. Keep replies short and factual.',
  tools: [{ type: 'agent_toolset_20260401', default_config: { enabled: true } }],
  skills: [{ type: 'custom', skill_id: skillId }],
})

// 2. Environment: reuse one if configured, else create a cloud sandbox with network access.
const environmentId =
  process.env.CLAUDE_ENVIRONMENT_ID ||
  (
    await anthropic.beta.environments.create({
      name: 'roster-x402-demo',
      config: { type: 'cloud', networking: { type: 'unrestricted' } },
    })
  ).id

// 3. Session, with a hard $3 cap on what the session itself may cost.
const session = await anthropic.beta.sessions.create({
  agent: { type: 'agent', id: agent.id, version: agent.version },
  environment_id: environmentId,
  title: 'x402 demo — comparable sales',
  budget: { type: 'limit', max_list_cost: { amount: '300', currency: 'USD' } },
})
console.log(`session  https://platform.claude.com/workspaces/default/sessions/${session.id}`)

// 4. Wallet.
await send(
  session.id,
  'Set up x402 per your x402-arc skill and report your WALLET_ADDRESS. Do not buy anything yet.',
)
const setup = await waitForReply(session.id, 0)
const address = setup.map((m) => m.text).join('\n').match(/WALLET_ADDRESS:\s*(0x[0-9a-fA-F]{40})/)?.[1] as
  | `0x${string}`
  | undefined
if (!address) {
  console.error('agent did not report a wallet address:\n' + setup.map((m) => m.text).join('\n---\n'))
  process.exit(1)
}
console.log(`agent wallet  ${address}`)

// 5. Fund it.
const tx = await wallet.writeContract({
  address: USDC,
  abi: erc20Abi,
  functionName: 'transfer',
  args: [address, FUND],
})
await chain.waitForTransactionReceipt({ hash: tx })
const funded = await usdcOf(address)
console.log(`funded  ${formatUnits(funded, 6)} USDC  (tx ${tx})`)

// 6. The task.
const before = (await agentMessages(session.id)).length
await send(
  session.id,
  `Your wallet now holds ${formatUnits(funded, 6)} USDC on Arc testnet. A seller's catalog is at ` +
    `${catalogUrl}. Find recent comparable sales for the Omega Speedmaster ref. 145.022 and buy ` +
    'them. Report what you bought, what it cost, the transaction hash, and one line on the data.',
)
const result = await waitForReply(session.id, before)
console.log('\n--- agent ---\n' + result.map((m) => m.text).join('\n---\n'))

// 7. Verify on-chain.
const after = await usdcOf(address)
console.log(`\nbalance  ${formatUnits(funded, 6)} -> ${formatUnits(after, 6)} USDC  (spent ${formatUnits(funded - after, 6)})`)
