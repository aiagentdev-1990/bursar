// End-to-end check of a Claude agent spending from a Roster allowance over x402 on Arc testnet.
//
//   npx tsx scripts/x402-roster-demo.ts <skill_id> <catalog_url>
//
// The agent's caps are set so one purchase clears and one is held:
//   per-transaction cap $0.008 -> market price ($0.005) executes, comparable sales ($0.01) holds.
// The owner then approves the held request and the agent completes the purchase.

import { resolve } from 'node:path'
import { config } from 'dotenv'
import Anthropic from '@anthropic-ai/sdk'
import { createPublicClient, createWalletClient, erc20Abi, formatUnits, http, parseEventLogs } from 'viem'
import { arcTestnet } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'
import { rosterAbi } from '../src/chain/abi.js'

config({ path: resolve(import.meta.dirname, '../../../.env') })

const [skillId, catalogUrl] = process.argv.slice(2)
if (!skillId || !catalogUrl) {
  console.error('usage: tsx scripts/x402-roster-demo.ts <skill_id> <catalog_url>')
  process.exit(1)
}

const USDC = '0x3600000000000000000000000000000000000000' as const
const ROSTER = process.env.ROSTER_CONTRACT_ADDRESS as `0x${string}` | undefined
if (!ROSTER) throw new Error('ROSTER_CONTRACT_ADDRESS is not set')

const PER_TX_CAP = 8_000n // $0.008
const PER_PERIOD_CAP = 50_000n // $0.05
const DEPOSIT = 50_000n // $0.05 added to the Roster's shared balance
/// Native USDC for the agent's own executeSpend transactions. Sized from measured Arc gas costs.
const GAS_FLOAT = BigInt(process.env.AGENT_GAS_FLOAT ?? '20000')

const rawKey = process.env.OWNER_PRIVATE_KEY?.trim()
if (!rawKey) throw new Error('OWNER_PRIVATE_KEY is not set')
const owner = privateKeyToAccount((rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`) as `0x${string}`)

const anthropic = new Anthropic()
const chain = createPublicClient({ chain: arcTestnet, transport: http() })
const wallet = createWalletClient({ account: owner, chain: arcTestnet, transport: http() })
const usd = (v: bigint) => `$${formatUnits(v, 6)}`

async function ownerTx(label: string, request: Parameters<typeof wallet.writeContract>[0]) {
  const hash = await wallet.writeContract(request)
  const receipt = await chain.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error(`${label} reverted (${hash})`)
  console.log(`  ${label.padEnd(22)} ${hash}`)
  return receipt
}

type AgentMessage = { id: string; text: string }

async function agentMessages(sessionId: string): Promise<AgentMessage[]> {
  const out: AgentMessage[] = []
  for await (const event of anthropic.beta.sessions.events.list(sessionId)) {
    if (event.type !== 'agent.message') continue
    const text = (event.content ?? [])
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
    out.push({ id: event.id, text })
  }
  return out
}

async function ask(sessionId: string, text: string, timeoutMs = 480_000): Promise<string> {
  const before = (await agentMessages(sessionId)).length
  await anthropic.beta.sessions.events.send(sessionId, {
    events: [{ type: 'user.message', content: [{ type: 'text', text }] }],
  })
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5_000))
    const { status } = await anthropic.beta.sessions.retrieve(sessionId)
    const messages = await agentMessages(sessionId)
    if (messages.length > before && (status === 'idle' || status === 'terminated')) {
      return messages
        .slice(before)
        .map((m) => m.text)
        .join('\n---\n')
    }
  }
  throw new Error(`no reply within ${timeoutMs / 1000}s`)
}

const agentInfo = async (address: `0x${string}`) =>
  chain.readContract({ address: ROSTER, abi: rosterAbi, functionName: 'getAgent', args: [address] })
const usdcOf = (address: `0x${string}`) =>
  chain.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [address] })

// 1. Agent with the skill, in a sandbox with network access, capped at $3 of session cost.
const agent = await anthropic.beta.agents.create({
  name: 'Roster · x402 test',
  model: 'claude-opus-5',
  system:
    'You are a research agent for a luxury watch reseller. You buy data with your x402-arc ' +
    'skill, from an allowance your owner controls. Keep replies short and factual.',
  tools: [{ type: 'agent_toolset_20260401', default_config: { enabled: true } }],
  skills: [{ type: 'custom', skill_id: skillId }],
})
const environmentId =
  process.env.CLAUDE_ENVIRONMENT_ID ||
  (
    await anthropic.beta.environments.create({
      name: 'roster-x402-demo',
      config: { type: 'cloud', networking: { type: 'unrestricted' } },
    })
  ).id
const session = await anthropic.beta.sessions.create({
  agent: { type: 'agent', id: agent.id, version: agent.version },
  environment_id: environmentId,
  title: 'Roster x402 test',
  budget: { type: 'limit', max_list_cost: { amount: '300', currency: 'USD' } },
})
console.log(`session  https://platform.claude.com/workspaces/default/sessions/${session.id}`)

// 2. The agent makes its wallet.
const setup = await ask(session.id, 'Set up per your x402-arc skill and report your WALLET_ADDRESS. Buy nothing yet.')
const address = setup.match(/WALLET_ADDRESS:\s*(0x[0-9a-fA-F]{40})/)?.[1] as `0x${string}` | undefined
if (!address) {
  console.error('agent did not report a wallet address:\n' + setup)
  process.exit(1)
}
console.log(`agent wallet  ${address}`)

// 3. The owner hires it: caps on the Roster, money in the Roster's shared balance, a little gas
//    in its wallet.
console.log('owner:')
await ownerTx('hireAgent', {
  address: ROSTER,
  abi: rosterAbi,
  functionName: 'hireAgent',
  args: [address, PER_TX_CAP, PER_PERIOD_CAP, 'x402 test|Automated paid-data purchase test'],
})
await ownerTx('add money to the Roster', { address: USDC, abi: erc20Abi, functionName: 'transfer', args: [ROSTER, DEPOSIT] })
await ownerTx('gas float to agent', { address: USDC, abi: erc20Abi, functionName: 'transfer', args: [address, GAS_FLOAT] })
const walletStart = await usdcOf(address)

// 4. Two purchases: one within the per-transaction cap, one over it.
const fromBlock = await chain.getBlockNumber()
console.log('\n--- agent: purchases ---')
console.log(
  await ask(
    session.id,
    `You are on the roster. Your Roster contract is ${ROSTER} — save it as your skill says. ` +
      `Your per-transaction cap is ${usd(PER_TX_CAP)} and your monthly cap is ${usd(PER_PERIOD_CAP)}. ` +
      `A seller's catalog is at ${catalogUrl}. For the Omega Speedmaster ref. 145.022, buy both the ` +
      'current market price and the recent comparable sales. Report the outcome of each.',
  ),
)

// 5. Find the held request on-chain and approve it as the owner.
const logs = await chain.getContractEvents({ address: ROSTER, abi: rosterAbi, eventName: 'PaymentPending', fromBlock })
const held = parseEventLogs({ abi: rosterAbi, logs }).filter(
  (l) => l.eventName === 'PaymentPending' && (l.args as { agent: string }).agent.toLowerCase() === address.toLowerCase(),
)
const pending = held.at(-1)
if (!pending) {
  console.log('\nno held request found — nothing to approve')
} else {
  const { requestId, amount } = pending.args as { requestId: bigint; amount: bigint }
  console.log(`\nowner approves request #${requestId} (${usd(amount)}):`)
  await ownerTx('approvePending', { address: ROSTER, abi: rosterAbi, functionName: 'approvePending', args: [requestId] })

  console.log('\n--- agent: after approval ---')
  console.log(
    await ask(
      session.id,
      `Your owner approved request #${requestId}. The ${usd(amount)} is now in your wallet. Complete that purchase.`,
    ),
  )
}

// 6. What the chain says.
const info = await agentInfo(address)
const walletEnd = await usdcOf(address)
console.log('\n--- on-chain ---')
console.log(`  spent this period   ${usd(info.periodSpend)}  (cap ${usd(info.perPeriodCap)})`)
console.log(`  roster balance      ${usd(await usdcOf(ROSTER))}`)
console.log(`  agent wallet        ${usd(walletStart)} -> ${usd(walletEnd)}  (gas used ${usd(walletStart - walletEnd)})`)
