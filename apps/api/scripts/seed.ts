// Funds the deployed Roster and plays a morning of agent activity against it, so the dashboard
// has real on-chain state to read. Every step is a real transaction on Arc testnet: the owner
// hires and earmarks through the same wrappers the API uses, and each agent signs its own spend
// with its own key, submitted by the relayer (`executeSpendFor`, the same call POST /relay/spend
// makes). Agents hold no gas — DECISIONS.md 2026-09-11. Nothing is faked off-chain: the caps you
// see enforced here are enforced by the contract, including the two requests that go pending.
//
// Every release is followed by the payment it was for, as in the real x402 flow: the agent signs
// an EIP-3009 authorization for exactly the released amount and the relayer submits it, as a
// seller's facilitator would. Released USDC passes straight through — an agent's wallet ends each
// spend where it started, at zero. (An earlier version released and stopped, stranding every
// amount; `pnpm --filter @roster/api sweep` recovered those.)
//
//   pnpm --filter @roster/api seed             fund the treasury, hire the five demo agents,
//                                              earmark their budgets, run the scripted morning
//   pnpm --filter @roster/api seed activity    one more in-cap spend per agent, for a live feed
//
// Idempotent where it matters: agents are matched by name in .roster-store.json and only hired
// if they are not already registered on the current ROSTER_CONTRACT_ADDRESS, so a re-run after a
// redeploy hires fresh wallets, and a re-run against the same Roster hires nobody twice. The
// scripted morning only plays against a freshly hired roster.
//
// Figures are the mockup roster (DECISIONS.md 2026-09-09) scaled to testnet money: caps are in
// cents, not dollars, because the demo's x402 services charge cents and the deployer holds ~$19.
// The *shape* is the mockups' — Runner holding an over-cap request, everyone else spending
// normally beside it — but the numbers are honest about what is actually in the treasury.
//
// Agent keys come from the LOCAL wallet provider path (services/wallets.ts): generated here,
// persisted to the same store the API reads. Dev scaffolding — the same caveat as
// WALLET_PROVIDER=local applies, and this refuses to run with NODE_ENV=production.

import {
  erc20Abi,
  formatUnits,
  parseUnits,
  stringToHex,
  zeroAddress,
  type Address,
  type Hex,
} from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { loadEnv } from '../src/env.js'
import { contractEnabled, ownerAccount, ownerClient, publicClient, relayerAccount, ROSTER_ADDRESS } from '../src/chain/chain.js'
import { rosterAbi } from '../src/chain/abi.js'
import * as contract from '../src/chain/roster.js'
import { encodeLabel } from '../src/services/labels.js'
import { store } from '../src/services/store.js'
import { transferWithAuthorization } from './lib/eip3009.js'

const env = loadEnv()

/// Exact decimal string → base units. Never a float, even in a script.
const usdc = (v: string): bigint => parseUnits(v, 6)
const fmt = (v: bigint): string => `$${formatUnits(v, 6)}`

// ─── the roster ─────────────────────────────────────────────────────────────

interface DemoAgent {
  name: string
  role: string
  perTxCap: bigint
  perPeriodCap: bigint
  /// Opening budget earmarked from the treasury. Sized to cover the scripted morning below with
  /// room left over — Runner's remainder is deliberately enough to approve its held request live.
  earmark: bigint
}

const AGENTS: DemoAgent[] = [
  { name: 'Pricer', role: 'Comparable-listing research', perTxCap: usdc('0.25'), perPeriodCap: usdc('3'), earmark: usdc('2') },
  { name: 'Concierge', role: 'Buyer questions and offers', perTxCap: usdc('0.20'), perPeriodCap: usdc('1.50'), earmark: usdc('0.80') },
  { name: 'Runner', role: 'One-off task payouts', perTxCap: usdc('0.75'), perPeriodCap: usdc('4'), earmark: usdc('3') },
  { name: 'Scout', role: 'Auction and estate sourcing', perTxCap: usdc('0.50'), perPeriodCap: usdc('2.50'), earmark: usdc('2') },
  { name: 'Ledger', role: 'Bookkeeping and reconciliation', perTxCap: usdc('0.40'), perPeriodCap: usdc('2'), earmark: usdc('1.60') },
]

/// Left unallocated in the treasury on top of the earmarks, so `GET /treasury` and a live
/// `fundAgent` during the demo have headroom.
const TREASURY_HEADROOM = usdc('0.60')

/// The relayer pays every agent's gas. On Arc the ERC-20 predeploy and the native gas asset are
/// the same balance, so a USDC transfer is also a gas top-up. A relayed spend costs well under a
/// cent, so this covers the morning many times over.
const RELAYER_GAS = usdc('0.50')
const RELAYER_GAS_FLOOR = 200_000_000_000_000_000n // 0.20 USDC at the native asset's 18 decimals

// ─── the scripted morning ───────────────────────────────────────────────────
// Oldest first. `payee` is display copy carried in the memo as "Payee — note", which is how the
// dashboard renders a payee name without ever holding an address book. The money itself settles
// to DEMO_SELLER, below.

interface Spend {
  agent: string
  amount: string
  payee: string
  note: string
  /// Only meaningful for a spend over a cap — what the owner does with the held request.
  owner?: 'approve' | 'reject'
}

const MORNING: Spend[] = [
  { agent: 'Runner', amount: '2.10', payee: 'Halden Courier', note: 'Insured overnight transit', owner: 'reject' },
  { agent: 'Pricer', amount: '0.17', payee: 'Brave Search', note: 'Reference-number price check' },
  { agent: 'Scout', amount: '0.38', payee: 'Invaluable', note: 'Estate lot watchlist, 12 lots' },
  { agent: 'Ledger', amount: '0.38', payee: 'Stripe Tax', note: 'Quarterly filing prep' },
  { agent: 'Runner', amount: '0.60', payee: 'Bench Watchmaking Co.', note: 'Service quote, Rolex 16610 bracelet' },
  { agent: 'Concierge', amount: '0.09', payee: 'Groq', note: 'Offer-response drafting' },
  { agent: 'Pricer', amount: '0.22', payee: 'Exa', note: 'Dealer inventory sweep, 3 sources' },
  { agent: 'Ledger', amount: '0.35', payee: 'Xero', note: 'Monthly reconciliation run' },
  { agent: 'Scout', amount: '0.80', payee: 'Heritage Auctions', note: "Buyer's-premium deposit, lot 214", owner: 'approve' },
  { agent: 'Concierge', amount: '0.06', payee: 'Twilio', note: 'Buyer SMS, 240 messages' },
  { agent: 'Runner', amount: '0.45', payee: 'Halden Courier', note: 'Insured ground transit, Speedmaster' },
  // Exactly at Ledger's per-transaction cap — the inclusive boundary, executed not held.
  { agent: 'Ledger', amount: '0.40', payee: 'QuickBooks', note: 'Payroll export' },
  { agent: 'Pricer', amount: '0.14', payee: 'Chrono24 Data', note: 'Comparable sold-listing pull' },
  { agent: 'Scout', amount: '0.38', payee: 'Invaluable', note: 'Auction alert feed, weekly' },
  { agent: 'Concierge', amount: '0.12', payee: 'Twilio', note: 'Buyer follow-up calls' },
  { agent: 'Runner', amount: '0.70', payee: 'Loupe Freelance', note: 'Strap-fitting task payout' },
  { agent: 'Ledger', amount: '0.30', payee: 'Stripe Tax', note: 'Sales-tax remittance prep' },
  { agent: 'Pricer', amount: '0.19', payee: 'Brave Search', note: 'Reference-number price check' },
  // The demo's held request (PRD §7 beat 4): over Runner's $0.75 per-transaction limit, left
  // open for the owner to approve on stage.
  { agent: 'Runner', amount: '1.20', payee: 'Verity Watch Authentication', note: 'Pre-purchase authentication, Omega ref. 145.022' },
]

/// `seed activity` rotates through these. All comfortably inside every agent's per-tx cap.
const ROUND: Record<string, Omit<Spend, 'agent'>> = {
  Pricer: { amount: '0.12', payee: 'Brave Search', note: 'Reference-number price check' },
  Concierge: { amount: '0.05', payee: 'Twilio', note: 'Buyer SMS, 180 messages' },
  Runner: { amount: '0.40', payee: 'Halden Courier', note: 'Local courier, same-day' },
  Scout: { amount: '0.25', payee: 'Invaluable', note: 'Auction alert feed, daily' },
  Ledger: { amount: '0.15', payee: 'Xero', note: 'Daily bank-feed sync' },
}

// ─── helpers ────────────────────────────────────────────────────────────────

/// Every mock seller is played by one real counterparty: the account apps/seller takes payments
/// with — SELLER_PRIVATE_KEY, falling back to the owner key, exactly as apps/seller does. The
/// payments have to land somewhere real; a made-up address would burn them. It is also the payee
/// the agent names in `executeSpendFor`, so what the contract records matches where money went.
const sellerKey = process.env.SELLER_PRIVATE_KEY?.trim()
const DEMO_SELLER: Address = sellerKey
  ? privateKeyToAccount((sellerKey.startsWith('0x') ? sellerKey : `0x${sellerKey}`) as Hex).address
  : ownerAccount.address

/// The x402 payment that follows a release: the agent signs an EIP-3009 authorization for exactly
/// the released amount and the relayer submits it, as a seller's facilitator would. The agent
/// sends nothing, and its wallet is back at zero afterwards.
async function payAs(agent: Hired, amount: bigint) {
  await transferWithAuthorization(agent.key, DEMO_SELLER, amount)
}

async function waitOk(hash: Hex, what: string) {
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error(`${what} reverted (${hash})`)
  return receipt
}

async function transferUsdc(to: Address, amount: bigint, what: string) {
  const hash = await ownerClient.writeContract({
    address: env.USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'transfer',
    args: [to, amount],
  } as never)
  await waitOk(hash, what)
}

interface Hired {
  demo: DemoAgent
  address: Address
  key: Hex
  fresh: boolean
}

async function ensureHired(demo: DemoAgent): Promise<Hired | undefined> {
  for (const stored of store.listAgents().filter((a) => a.name === demo.name)) {
    const address = stored.wallet as Address
    const info = await contract.getAgent(address)
    if (!info.registered) continue // from an earlier deployment

    const key = store.getLocalKey(address) as Hex | undefined
    if (!key) {
      console.warn(`  ${demo.name}: registered, but no local key in the store — cannot spend as it`)
      return undefined
    }
    return { demo, address, key, fresh: false }
  }

  const key = generatePrivateKey()
  const address = privateKeyToAccount(key).address
  // Persist the key before registering: a registered agent whose key was lost can never spend.
  store.setLocalKey(address, key)

  await contract.hireAgent(address, demo.perTxCap, demo.perPeriodCap, encodeLabel({ name: demo.name, role: demo.role }))
  store.putAgent({
    wallet: address,
    name: demo.name,
    role: demo.role,
    perTxCap: demo.perTxCap.toString(),
    perPeriodCap: demo.perPeriodCap.toString(),
    createdAt: new Date().toISOString(),
  })

  console.log(`  hired ${demo.name.padEnd(10)} ${fmt(demo.perTxCap)} per tx, ${fmt(demo.perPeriodCap)} a period`)
  return { demo, address, key, fresh: true }
}

async function ensureRelayerGas() {
  if (!relayerAccount) throw new Error('RELAYER_PRIVATE_KEY is not set — agents hold no gas, so every spend is relayed.')
  const balance = await publicClient.getBalance({ address: relayerAccount.address })
  if (balance >= RELAYER_GAS_FLOOR) return
  await transferUsdc(relayerAccount.address, RELAYER_GAS, 'gas for the relayer')
  console.log(`relayer   topped up with ${fmt(RELAYER_GAS)} for gas`)
}

/// The agent signs with its own key; the relayer submits and pays — `contract.relaySpend`, the
/// same function POST /relay/spend calls. The domain comes from the contract's `eip712Domain()`,
/// as the skill reads it. The outcome is read from the receipt's events, so it is what actually
/// happened on-chain.
async function spendAs(agent: Hired, spend: Omit<Spend, 'agent'>): Promise<{ executed: boolean; requestId?: bigint }> {
  const amount = usdc(spend.amount)
  const payee = DEMO_SELLER
  const memo = stringToHex(`${spend.payee} — ${spend.note}`)
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600)

  const [nonce, [, name, version, chainId, verifyingContract]] = await Promise.all([
    publicClient.readContract({ address: ROSTER_ADDRESS, abi: rosterAbi, functionName: 'nonces', args: [agent.address] }),
    publicClient.readContract({ address: ROSTER_ADDRESS, abi: rosterAbi, functionName: 'eip712Domain' }),
  ])

  const signature = await privateKeyToAccount(agent.key).signTypedData({
    domain: { name, version, chainId, verifyingContract },
    types: contract.SPEND_TYPES,
    primaryType: 'Spend',
    message: { agent: agent.address, amount, payee, memo, nonce, deadline },
  })

  const outcome = await contract.relaySpend({ agent: agent.address, amount, payee, memo, deadline, signature })
  return { executed: outcome.executed, requestId: outcome.requestId }
}

async function play(hired: Map<string, Hired>, spends: Spend[]) {
  for (const spend of spends) {
    const agent = hired.get(spend.agent)
    if (!agent) continue

    const outcome = await spendAs(agent, spend)
    const line = `  ${agent.demo.name.padEnd(10)} ${fmt(usdc(spend.amount)).padStart(6)}  ${spend.payee}`

    if (outcome.executed) {
      await payAs(agent, usdc(spend.amount))
      console.log(`${line} — released, paid`)
      continue
    }

    const id = outcome.requestId!
    if (spend.owner === 'approve') {
      await contract.approvePending(id)
      await payAs(agent, usdc(spend.amount))
      console.log(`${line} — held as #${id}, approved by the owner, paid`)
    } else if (spend.owner === 'reject') {
      await contract.rejectPending(id)
      console.log(`${line} — held as #${id}, rejected by the owner`)
    } else {
      console.log(`${line} — HELD as #${id}, waiting for the owner`)
    }
  }
}

async function summary(hired: Hired[]) {
  console.log('\nroster')
  for (const agent of hired) {
    const info = await contract.getAgent(agent.address)
    console.log(
      `  ${agent.demo.name.padEnd(10)} spent ${fmt(info.periodSpend).padStart(6)} of ${fmt(info.perPeriodCap).padEnd(6)}` +
        `  earmark left ${fmt(info.earmarkedBalance).padStart(6)}  ${info.active ? 'active' : 'revoked'}`,
    )
  }
  const [earmarked, unallocated] = await Promise.all([contract.getTotalEarmarked(), contract.getUnallocatedTreasury()])
  console.log(`\ntreasury  earmarked ${fmt(earmarked)}, unallocated ${fmt(unallocated)}`)
  console.log(`explorer  https://testnet.arcscan.app/address/${ROSTER_ADDRESS}`)
}

// ─── main ───────────────────────────────────────────────────────────────────

async function main() {
  if (env.NODE_ENV === 'production') throw new Error('seed generates local agent keys; never run it in production.')
  if (!contractEnabled()) throw new Error('ROSTER_CONTRACT_ADDRESS is not set. Deploy first: packages/contracts/script/Deploy.s.sol.')

  const owner = await contract.getOwner()
  if (owner.toLowerCase() !== ownerAccount.address.toLowerCase()) {
    throw new Error(`OWNER_PRIVATE_KEY signs as ${ownerAccount.address}, but the Roster's owner is ${owner}.`)
  }

  const mode = process.argv[2] ?? 'all'
  if (mode !== 'all' && mode !== 'activity') throw new Error(`Unknown mode "${mode}". Use no argument, or "activity".`)

  console.log(`roster ${ROSTER_ADDRESS} on chain ${env.ARC_CHAIN_ID}\n`)

  if (mode === 'activity') {
    const hired = (await Promise.all(AGENTS.map(findExisting))).filter((h): h is Hired => h !== undefined)
    if (hired.length === 0) throw new Error('No seeded agents on this Roster yet. Run the full seed first.')
    await ensureRelayerGas()

    const live: Hired[] = []
    for (const agent of hired) {
      const info = await contract.getAgent(agent.address)
      if (info.active && info.earmarkedBalance >= usdc(ROUND[agent.demo.name]!.amount)) live.push(agent)
      else console.log(`  ${agent.demo.name.padEnd(10)} skipped — ${info.active ? 'earmark too low' : 'revoked'}`)
    }
    await play(new Map(live.map((a) => [a.demo.name, a])), live.map((a) => ({ agent: a.demo.name, ...ROUND[a.demo.name]! })))
    await summary(hired)
    return
  }

  // 1. Hire. Registration first, so the caps are live before a cent is earmarked.
  // Sequential: every hire is signed by the one owner account, and concurrent sends race for the
  // same nonce ("replacement transaction underpriced").
  console.log('hiring')
  const hired: Hired[] = []
  for (const demo of AGENTS) {
    const agent = await ensureHired(demo)
    if (agent) hired.push(agent)
  }
  if (hired.every((h) => !h.fresh)) console.log('  everyone is already on the roster')

  // "Never funded and never spent" rather than "hired this run", so a run that died between
  // hiring and earmarking picks up where it stopped instead of leaving an agent with no budget.
  const before = new Map<Address, contract.AgentInfo>()
  for (const h of hired) before.set(h.address, await contract.getAgent(h.address))
  const fresh = hired.filter((h) => before.get(h.address)!.earmarkedBalance === 0n && before.get(h.address)!.periodSpend === 0n)

  // 2. Deliver USDC to the Roster (§4.6 — Bridge Kit's job, played here by a plain transfer),
  //    only as much as the new earmarks need beyond what is already unallocated.
  const needed = fresh.reduce((total, h) => total + h.demo.earmark, 0n)
  if (needed > 0n) {
    const unallocated = await contract.getUnallocatedTreasury()
    const deficit = needed + TREASURY_HEADROOM - unallocated
    if (deficit > 0n) {
      const wallet = await publicClient.readContract({
        address: env.USDC_ADDRESS,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [ownerAccount.address],
      })
      if (wallet < deficit + RELAYER_GAS) {
        throw new Error(`The owner holds ${fmt(wallet)} but seeding needs ${fmt(deficit + RELAYER_GAS)}. Top up from the Arc faucet.`)
      }
      await transferUsdc(ROSTER_ADDRESS, deficit, 'treasury deposit')
      console.log(`\ntreasury  deposited ${fmt(deficit)}`)
    }
  }

  // 3. Earmark each new agent's opening budget. Moves no tokens — the USDC is already there.
  if (fresh.length > 0) console.log('\nearmarking')
  for (const agent of fresh) {
    await contract.fundAgent(agent.address, agent.demo.earmark)
    console.log(`  ${agent.demo.name.padEnd(10)} ${fmt(agent.demo.earmark)}`)
  }

  // 4. Gas for the relayer — never for an agent — then the morning, only against a roster that
  //    has not already had one.
  await ensureRelayerGas()

  // The morning's cap math assumes a clean slate: nobody has spent and no request has ever been
  // held. Anything else means it already ran (or partly ran), and replaying it would double it.
  const untouched =
    hired.length === AGENTS.length &&
    [...before.values()].every((info) => info.periodSpend === 0n) &&
    (await contract.getPendingRequest(1n)).agent === zeroAddress

  if (untouched) {
    console.log('\nthe morning')
    await play(new Map(hired.map((h) => [h.demo.name, h])), MORNING)
  } else {
    console.log('\nroster already has activity — skipping the scripted morning. `seed activity` adds more spends.')
  }

  await summary(hired)
}

async function findExisting(demo: DemoAgent): Promise<Hired | undefined> {
  for (const stored of store.listAgents().filter((a) => a.name === demo.name)) {
    const address = stored.wallet as Address
    if (!(await contract.getAgent(address)).registered) continue
    const key = store.getLocalKey(address) as Hex | undefined
    if (key) return { demo, address, key, fresh: false }
  }
  return undefined
}

main().catch((error) => {
  console.error(`\nseed failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
