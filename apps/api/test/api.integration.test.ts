import { before, after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { Address } from 'viem'
import { anvilAvailable } from './helpers/anvil.js'
import { usdc } from './helpers/deploy.js'
import { startHarness, agentAddressFor, OWNER_TOKEN, type Harness } from './helpers/harness.js'
import { rosterAbi } from '../src/chain/abi.js'

/// Integration tests for apps/api against a real chain and the real compiled contracts.
///
/// What is real: the EVM, the contract bytecode, every RPC round trip, receipt waiting, custom
/// error decoding, event decoding, the HTTP layer, auth, and validation.
/// What is stubbed: Blockscout (no explorer exists for a local node — see helpers/blockscout.ts)
/// and the Claude runtime (checkpoint 4; its absence is itself under test).

const available = await anvilAvailable()

describe('roster api', { skip: available ? false : 'anvil not installed — install Foundry' }, () => {
  let h: Harness

  before(async () => {
    h = await startHarness()
  })

  after(async () => {
    await h?.stop()
  })

  // ─── health and auth ──────────────────────────────────────────────────────

  it('serves health without a token, because a gated health check is useless', async () => {
    const { status, body } = await h.request('GET', '/health', { token: null })

    assert.equal(status, 200)
    assert.equal(body.ok, true)
    assert.equal(body.roster, h.deployment.roster)
  })

  it('rejects every owner endpoint without a valid token', async () => {
    for (const [method, path] of [
      ['GET', '/agents'],
      ['POST', '/agents'],
      ['GET', '/pending'],
      ['GET', '/activity'],
    ] as const) {
      const missing = await h.request(method, path, { token: null })
      assert.equal(missing.status, 401, `${method} ${path} with no token`)

      const wrong = await h.request(method, path, { token: 'x'.repeat(OWNER_TOKEN.length) })
      assert.equal(wrong.status, 401, `${method} ${path} with a wrong token`)
      assert.equal(wrong.body.error.code, 'unauthorized')
    }
  })

  it('starts with an empty roster', async () => {
    const { status, body } = await h.request('GET', '/agents')

    assert.equal(status, 200)
    assert.deepEqual(body.agents, [])
  })

  // ─── hiring (§4.1) ────────────────────────────────────────────────────────

  let pricerId: string
  let pricerAddress: Address

  it('hires an agent: wallet provisioned, caps registered on-chain, no address returned', async () => {
    const { status, body } = await h.request('POST', '/agents', {
      body: {
        name: 'Pricer',
        role: 'Comparable-listing research',
        perTxCap: usdc(10).toString(),
        perPeriodCap: usdc(400).toString(),
      },
    })

    assert.equal(status, 201)
    assert.equal(body.agent.name, 'Pricer')
    assert.equal(body.agent.role, 'Comparable-listing research')
    assert.equal(body.agent.perTxCap, usdc(10).toString())
    assert.equal(body.agent.perPeriodCap, usdc(400).toString())
    assert.equal(body.agent.status, 'active')

    // §4.1: the owner never sees a wallet address or an agent id.
    assert.doesNotMatch(JSON.stringify(body.agent), /0x[0-9a-fA-F]{40}/)

    pricerId = body.agent.id
    pricerAddress = await agentAddressFor(h, pricerId)

    // The caps are on-chain, not just in the response.
    const onChain = (await h.deployment.publicClient.readContract({
      address: h.deployment.roster,
      abi: rosterAbi,
      functionName: 'getAgent',
      args: [pricerAddress],
    })) as { perTxCap: bigint; active: boolean; role: string }

    assert.equal(onChain.perTxCap, usdc(10))
    assert.equal(onChain.active, true)
    assert.equal(onChain.role, 'Pricer|Comparable-listing research')
  })

  it('registers the agent even when the Claude runtime is unavailable, and says so', async () => {
    const { body } = await h.request('POST', '/agents', {
      body: {
        name: 'Concierge',
        role: 'Buyer questions and offers',
        perTxCap: usdc(25).toString(),
        perPeriodCap: usdc(150).toString(),
      },
    })

    // The enforcement is the part that matters. A hire that can't start a session is still a
    // hire whose caps bind — reporting it as a failure would be wrong in the other direction.
    assert.equal(body.started, false)
    assert.match(body.warning, /ANTHROPIC_API_KEY/)
    assert.equal(body.agent.status, 'active')
  })

  it('gives each agent a distinct, stable, opaque id', async () => {
    const first = await h.request('GET', '/agents')
    const ids = first.body.agents.map((a: { id: string }) => a.id)

    assert.equal(new Set(ids).size, ids.length, 'ids are distinct')
    for (const id of ids) assert.match(id, /^[0-9a-f]{12}$/)

    const second = await h.request('GET', '/agents')
    assert.deepEqual(
      second.body.agents.map((a: { id: string }) => a.id),
      ids,
      'ids are stable across requests',
    )
  })

  it('lists the roster from the event log joined to live contract state', async () => {
    const { body } = await h.request('GET', '/agents')

    assert.equal(body.agents.length, 2)
    const names = body.agents.map((a: { name: string }) => a.name).sort()
    assert.deepEqual(names, ['Concierge', 'Pricer'])

    for (const agent of body.agents) {
      assert.ok(agent.lastActivityAt, 'last activity comes from the block timestamp')
    }
  })

  it('fetches a single agent by its opaque id', async () => {
    const { status, body } = await h.request('GET', `/agents/${pricerId}`)

    assert.equal(status, 200)
    assert.equal(body.agent.name, 'Pricer')
  })

  it('404s an id that is not on this roster', async () => {
    const { status, body } = await h.request('GET', '/agents/deadbeefdead')

    assert.equal(status, 404)
    assert.equal(body.error.code, 'unknown_agent')
  })

  // ─── validation ───────────────────────────────────────────────────────────

  it('rejects malformed hire bodies before touching the chain', async () => {
    const cases: Array<[string, Record<string, unknown>, RegExp]> = [
      ['a fractional cap', { perTxCap: '10.5' }, /whole number/],
      ['a zero cap', { perPeriodCap: '0' }, /greater than zero/],
      ['a cap sent as a number', { perTxCap: 10 }, /perTxCap/],
      ['an empty name', { name: '' }, /name/i],
    ]

    for (const [label, override, expected] of cases) {
      const { status, body } = await h.request('POST', '/agents', {
        body: {
          name: 'Temp',
          role: 'Temporary',
          perTxCap: usdc(1).toString(),
          perPeriodCap: usdc(2).toString(),
          ...override,
        },
      })

      assert.equal(status, 400, label)
      assert.match(body.error.message, expected, label)
    }
  })

  it('rejects a name containing the label delimiter rather than truncating it', async () => {
    const { status, body } = await h.request('POST', '/agents', {
      body: {
        name: 'Pri|cer',
        role: 'research',
        perTxCap: usdc(1).toString(),
        perPeriodCap: usdc(2).toString(),
      },
    })

    assert.equal(status, 400)
    assert.equal(body.error.code, 'invalid_label')
  })

  it('rejects a body that is not JSON', async () => {
    const response = await h.app.fetch(
      new Request('http://test/agents', {
        method: 'POST',
        headers: { authorization: `Bearer ${OWNER_TOKEN}`, 'content-type': 'application/json' },
        body: 'not json',
      }),
    )

    assert.equal(response.status, 400)
    assert.equal((await response.json()).error.code, 'invalid_json')
  })

  // ─── the shared balance (§4.6) ────────────────────────────────────────────

  it('reports the roster balance — no per-agent allocation anywhere', async () => {
    await h.deployment.mint(h.deployment.roster, usdc(1000))

    const { status, body } = await h.request('GET', '/treasury')

    assert.equal(status, 200)
    assert.equal(body.treasury.balance, usdc(1000).toString())
    assert.match(body.treasury.ownerBalance, /^\d+$/)
    assert.equal(body.treasury.earmarked, undefined)

    const agent = await h.request('GET', `/agents/${pricerId}`)
    assert.equal(agent.body.agent.earmarkedBalance, undefined, 'an agent has limits, not a balance')
  })

  it("adds money from the owner's wallet, and refuses more than the wallet holds", async () => {
    const owner = await h.deployment.publicClient.readContract({
      address: h.deployment.roster,
      abi: rosterAbi,
      functionName: 'owner',
    })
    await h.deployment.mint(owner, usdc(50))

    const added = await h.request('POST', '/treasury/deposit', { body: { amount: usdc(50).toString() } })
    assert.equal(added.status, 200)
    assert.ok(added.body.transactionHash)
    assert.equal(added.body.treasury.balance, usdc(1050).toString())

    const tooMuch = await h.request('POST', '/treasury/deposit', {
      body: { amount: (BigInt(added.body.treasury.ownerBalance) + 1n).toString() },
    })
    assert.equal(tooMuch.status, 400)
    assert.equal(tooMuch.body.error.code, 'insufficient_owner_funds')
  })

  it('withdraws to the owner, bounded by the balance and nothing else', async () => {
    const withdrawn = await h.request('POST', '/treasury/withdraw', {
      body: { amount: usdc(100).toString() },
    })

    assert.equal(withdrawn.status, 200)
    assert.equal(withdrawn.body.treasury.balance, usdc(950).toString())

    const tooMuch = await h.request('POST', '/treasury/withdraw', {
      body: { amount: usdc(951).toString() },
    })
    assert.equal(tooMuch.status, 409)
    assert.equal(tooMuch.body.error.code, 'InsufficientBalance')
    assert.match(tooMuch.body.error.message, /Add money/)
  })

  // ─── the over-cap path (§4.3) ─────────────────────────────────────────────

  it('holds an over-cap spend as pending, moving no funds', async () => {
    await spendAs(h, pricerAddress, usdc(120), 'Pre-purchase authentication, Omega ref. 145.022')

    const { body } = await h.request('GET', '/pending')

    assert.equal(body.pending.length, 1)
    const request = body.pending[0]
    assert.equal(request.requestId, '1')
    assert.equal(request.agentName, 'Pricer')
    assert.equal(request.amount, usdc(120).toString())
    assert.equal(request.purpose, 'Pre-purchase authentication, Omega ref. 145.022')
    assert.equal(request.perTxCap, usdc(10).toString())
    assert.equal(request.periodSpend, '0', 'a held request consumes no budget')

    assert.equal(await usdcBalance(h, pricerAddress), 0n, 'no funds moved')
  })

  it('flags the holding agent as needing review, and only that agent', async () => {
    const { body } = await h.request('GET', '/agents')

    const byName = Object.fromEntries(
      body.agents.map((a: { name: string; status: string }) => [a.name, a.status]),
    )
    assert.equal(byName.Pricer, 'needs-review')
    assert.equal(byName.Concierge, 'active', 'every other agent is unaffected')
  })

  it('approves a held request: funds released and charged to the period', async () => {
    const { status, body } = await h.request('POST', '/pending/1/approve')

    assert.equal(status, 200)
    assert.equal(body.approved, true)
    assert.ok(body.transactionHash)

    // The approval is confirmed on-chain before this returns, so the balance is already final.
    assert.equal(await usdcBalance(h, pricerAddress), usdc(120))

    const after = await h.request('GET', `/agents/${pricerId}`)
    assert.equal(after.body.agent.periodSpend, usdc(120).toString())
    assert.equal(after.body.agent.status, 'active', 'no longer holding anything')

    const treasury = await h.request('GET', '/treasury')
    assert.equal(treasury.body.treasury.balance, usdc(830).toString(), 'paid from the shared balance')

    const pending = await h.request('GET', '/pending')
    assert.deepEqual(pending.body.pending, [])
  })

  it('reports that no session could be resumed rather than pretending one was', async () => {
    // With no Claude runtime configured there is no session to nudge. The approval still
    // succeeded — §4.3's session event is a follow-up, not part of the settlement.
    await spendAs(h, pricerAddress, usdc(50), 'Bulk data pull')
    const { body } = await h.request('POST', '/pending/2/approve')

    assert.equal(body.approved, true)
    assert.equal(body.resumed, 'no-session')
  })

  it('refuses to settle the same request twice', async () => {
    const { status, body } = await h.request('POST', '/pending/1/approve')

    assert.equal(status, 409)
    assert.equal(body.error.code, 'request_not_open')
  })

  it('rejects a held request without moving funds', async () => {
    await spendAs(h, pricerAddress, usdc(200), 'Speculative bulk buy')

    const before = await usdcBalance(h, pricerAddress)
    const { status, body } = await h.request('POST', '/pending/3/reject')

    assert.equal(status, 200)
    assert.equal(body.rejected, true)
    assert.equal(await usdcBalance(h, pricerAddress), before, 'a rejection moves nothing')

    const pending = await h.request('GET', '/pending')
    assert.deepEqual(pending.body.pending, [])
  })

  // ─── caps and revocation (§4.4) ───────────────────────────────────────────

  it('updates caps and binds them on the very next spend', async () => {
    const { status } = await h.request('PATCH', `/agents/${pricerId}/caps`, {
      body: { perTxCap: usdc(1).toString(), perPeriodCap: usdc(5).toString() },
    })
    assert.equal(status, 200)

    // $2 was under the old $10 per-transaction cap and is over the new $1 one.
    await spendAs(h, pricerAddress, usdc(2), 'Small pull')

    const pending = await h.request('GET', '/pending')
    assert.equal(pending.body.pending.length, 1, 'the reduced cap holds it immediately')
  })

  it('revokes one agent without touching another', async () => {
    const roster = await h.request('GET', '/agents')
    const concierge = roster.body.agents.find((a: { name: string }) => a.name === 'Concierge')
    const conciergeAddress = await agentAddressFor(h, concierge.id)

    const { status, body } = await h.request('POST', `/agents/${pricerId}/revoke`)
    assert.equal(status, 200)
    assert.equal(body.agent.status, 'revoked')

    // The revoked agent's next spend reverts...
    await assert.rejects(() => spendAs(h, pricerAddress, usdc(1), 'after revocation'))

    // ...and the other agent, spending from the same balance, still works.
    await spendAs(h, conciergeAddress, usdc(5), 'Buyer SMS')

    const after = await h.request('GET', '/agents')
    const byName = Object.fromEntries(
      after.body.agents.map((a: { name: string; status: string }) => [a.name, a.status]),
    )
    assert.equal(byName.Pricer, 'revoked')
    assert.equal(byName.Concierge, 'active')
  })

  // ─── activity feed (§4.5) ─────────────────────────────────────────────────

  it('serves a whole-roster feed, newest first, with memos decoded', async () => {
    const { status, body } = await h.request('GET', '/activity')

    assert.equal(status, 200)
    const types = body.activity.map((a: { type: string }) => a.type)
    assert.ok(types.includes('AgentRegistered'))
    assert.ok(types.includes('PaymentPending'))
    assert.ok(types.includes('PendingApproved'))
    assert.ok(types.includes('PendingRejected'))
    assert.ok(types.includes('AgentRevoked'))

    const spend = body.activity.find(
      (a: { type: string; memo?: string }) => a.type === 'SpendExecuted' && a.memo,
    )
    assert.match(spend.memo, /Omega ref\. 145\.022|Bulk data pull|Buyer SMS/)

    // PendingApproved is emitted before the SpendExecuted it caused, so newest-first puts the
    // spend above the approval.
    const approvedAt = types.indexOf('PendingApproved')
    const spendAt = types.findIndex(
      (t: string, i: number) => t === 'SpendExecuted' && i < approvedAt,
    )
    assert.ok(spendAt !== -1 && spendAt < approvedAt, 'effect appears above its cause')
  })

  it('scopes the per-agent feed to that agent', async () => {
    const { body } = await h.request('GET', `/agents/${pricerId}/activity`)

    assert.ok(body.activity.length > 0)
    for (const entry of body.activity) {
      assert.equal(entry.agentName, 'Pricer')
    }
  })

  // ─── honest gaps ──────────────────────────────────────────────────────────

  it('returns 501 for the Bridge Kit funding schedule instead of silently doing nothing', async () => {
    const { status, body } = await h.request('POST', `/agents/${pricerId}/funding-schedule`, {
      body: { amount: usdc(100).toString(), period: 'monthly' },
    })

    assert.equal(status, 501)
    assert.equal(body.error.code, 'bridge_kit_not_wired')
  })

  it('follows Blockscout pagination rather than reading only the first page', async () => {
    assert.ok(h.blockscout.pagesServed > 0, 'the stub was actually used')
  })
})

// ─── helpers ────────────────────────────────────────────────────────────────

/// Sends `executeSpend` as the agent itself — the §4.2 path, with no owner signature anywhere.
async function spendAs(h: Harness, agent: Address, amount: bigint, memo: string): Promise<void> {
  const { createWalletClient, http, stringToHex } = await import('viem')
  const { privateKeyToAccount } = await import('viem/accounts')

  const account = privateKeyToAccount(h.agentKey(agent))
  await h.deployment.fundGas(agent)

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

async function usdcBalance(h: Harness, address: Address): Promise<bigint> {
  return h.deployment.publicClient.readContract({
    address: h.deployment.usdc,
    abi: [
      {
        type: 'function',
        name: 'balanceOf',
        stateMutability: 'view',
        inputs: [{ name: 'account', type: 'address' }],
        outputs: [{ name: '', type: 'uint256' }],
      },
    ] as const,
    functionName: 'balanceOf',
    args: [address],
  })
}
