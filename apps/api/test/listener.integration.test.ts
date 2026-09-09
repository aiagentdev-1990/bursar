import { before, after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { Address } from 'viem'
import { createWalletClient, http, stringToHex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { anvilAvailable } from './helpers/anvil.js'
import { usdc } from './helpers/deploy.js'
import { startHarness, agentAddressFor, type Harness } from './helpers/harness.js'
import { rosterAbi } from '../src/chain/abi.js'

/// Checkpoint 7's watcher, on its own. It is not an endpoint and nothing in the HTTP suite
/// exercises it, so it gets its own file and its own chain.
///
/// The behaviour that matters: it fires on a held payment and stays quiet on an ordinary in-cap
/// one. A watcher that fired on every spend would bury the one event the owner has to act on.

const available = await anvilAvailable()

describe(
  'PaymentPending listener',
  { skip: available ? false : 'anvil not installed — install Foundry' },
  () => {
    let h: Harness
    let unwatch: () => void
    let agent: Address
    const notices: Array<{ requestId: bigint; amount: bigint; purpose: string; payee: string }> = []

    before(async () => {
      h = await startHarness()

      const { watchPaymentPending } = await import('../src/listener.js')
      unwatch = watchPaymentPending((notice) => notices.push(notice), { pollingIntervalMs: 150 })

      const hired = await h.request('POST', '/agents', {
        body: {
          name: 'Runner',
          role: 'One-off task payouts',
          perTxCap: usdc(75).toString(),
          perPeriodCap: usdc(900).toString(),
        },
      })
      agent = await agentAddressFor(h, hired.body.agent.id)

      await h.deployment.mint(h.deployment.roster, usdc(1000))
      await h.request('POST', `/agents/${hired.body.agent.id}/fund`, {
        body: { amount: usdc(900).toString() },
      })
      await h.deployment.fundGas(agent)
    })

    after(async () => {
      unwatch?.()
      await h?.stop()
    })

    it('stays quiet on an in-cap spend', async () => {
      await spend(h, agent, usdc(50), 'Courier booking')
      await settle()

      assert.deepEqual(notices, [], 'an ordinary spend is not the owner’s problem')
    })

    it('fires on an over-cap spend, with the memo decoded', async () => {
      await spend(h, agent, usdc(120), 'Pre-purchase authentication, Omega ref. 145.022')

      await waitFor(() => notices.length === 1, 10_000)

      const notice = notices[0]!
      assert.equal(notice.requestId, 1n)
      assert.equal(notice.amount, usdc(120))
      assert.equal(notice.purpose, 'Pre-purchase authentication, Omega ref. 145.022')
      assert.equal(notice.payee.toLowerCase(), '0x000000000000000000000000000000000000dead')
    })

    it('does not fire again once the request is approved', async () => {
      const before = notices.length

      const approved = await h.request('POST', '/pending/1/approve')
      assert.equal(approved.status, 200)
      await settle()

      // Approval emits PendingApproved and SpendExecuted, neither of which this watches.
      assert.equal(notices.length, before, 'settling a request is not a new pending payment')
    })

    it('stops delivering after unwatch', async () => {
      unwatch()
      const before = notices.length

      await spend(h, agent, usdc(400), 'Second over-cap request')
      await settle()

      assert.equal(notices.length, before)
    })
  },
)

// ─── helpers ────────────────────────────────────────────────────────────────

async function spend(h: Harness, agent: Address, amount: bigint, memo: string): Promise<void> {
  const account = privateKeyToAccount(h.agentKey(agent))
  const wallet = createWalletClient({
    account,
    chain: h.deployment.chain,
    transport: http(h.deployment.chain.rpcUrls.default.http[0]),
  })

  const hash = await wallet.writeContract({
    address: h.deployment.roster,
    abi: rosterAbi,
    functionName: 'executeSpend',
    args: [amount, '0x000000000000000000000000000000000000dEaD', stringToHex(memo)],
    account,
    chain: h.deployment.chain,
  })
  await h.deployment.publicClient.waitForTransactionReceipt({ hash })
}

async function waitFor(condition: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (condition()) return
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error(`condition not met within ${timeoutMs}ms`)
}

/// Long enough for several poll cycles, so "nothing arrived" means it — not that we looked early.
const settle = () => new Promise((r) => setTimeout(r, 1200))
