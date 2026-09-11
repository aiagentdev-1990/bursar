import { before, after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { stringToHex, type Address, type Hex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { anvilAvailable } from './helpers/anvil.js'
import { usdc } from './helpers/deploy.js'
import { startHarness, agentAddressFor, RELAYER_KEY, type Harness } from './helpers/harness.js'
import { rosterAbi } from '../src/chain/abi.js'
// Not from chain/roster.js: that loads the environment at import time, before the harness sets
// it, and the app would boot against the real .env. See helpers/harness.ts.
import { SPEND_TYPES } from '../src/chain/spend.js'

/// POST /relay/spend — the one route an agent calls, and the only unauthenticated one that
/// writes. An agent that has never held gas signs a spend; the relay submits it and pays.
///
/// What is under test is that the relay adds nothing of its own: every refusal is the contract's
/// custom error, and a refused submission costs the relayer no gas.

const available = await anvilAvailable()

const PAYEE: Address = '0x000000000000000000000000000000000000dEaD'
const MEMO = stringToHex('Comparable sold-listing pull')
const relayer = privateKeyToAccount(RELAYER_KEY).address

describe('relay', { skip: available ? false : 'anvil not installed — install Foundry' }, () => {
  let h: Harness
  let agent: Address
  let agentId: string

  before(async () => {
    h = await startHarness()
    await h.deployment.mint(h.deployment.roster, usdc(1_000))

    const { status, body } = await h.request('POST', '/agents', {
      body: {
        name: 'Pricer',
        role: 'Comparable-listing research',
        perTxCap: usdc(10).toString(),
        perPeriodCap: usdc(400).toString(),
        fundAmount: usdc(100).toString(),
      },
    })
    assert.equal(status, 201, `hire failed: ${JSON.stringify(body)}`)
    agentId = body.agent.id
    agent = await agentAddressFor(h, agentId)
  })

  after(async () => {
    await h?.stop()
  })

  // ─── helpers ──────────────────────────────────────────────────────────────

  async function nonceOf(address: Address): Promise<bigint> {
    return h.deployment.publicClient.readContract({
      address: h.deployment.roster,
      abi: rosterAbi,
      functionName: 'nonces',
      args: [address],
    })
  }

  /// The agent's side of the flow, exactly as the skill does it: read the nonce, sign, send.
  async function signed(amount: bigint, opts: { deadline?: bigint; key?: Hex } = {}) {
    const deadline = opts.deadline ?? BigInt(Math.floor(Date.now() / 1000) + 600)
    const signature = await privateKeyToAccount(opts.key ?? h.agentKey(agent)).signTypedData({
      domain: { name: 'Roster', version: '1', chainId: h.deployment.chain.id, verifyingContract: h.deployment.roster },
      types: SPEND_TYPES,
      primaryType: 'Spend',
      message: { agent, amount, payee: PAYEE, memo: MEMO, nonce: await nonceOf(agent), deadline },
    })
    return { agent, amount: amount.toString(), payee: PAYEE, memo: MEMO, deadline: deadline.toString(), signature }
  }

  const relay = (body: unknown) => h.request('POST', '/relay/spend', { body, token: null })

  const relayerTxCount = () => h.deployment.publicClient.getTransactionCount({ address: relayer })

  async function usdcBalance(address: Address): Promise<bigint> {
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

  /// A refusal must come from simulation, never from a mined revert the relayer paid for.
  async function assertRefused(body: unknown, status: number, code: string) {
    const before = await relayerTxCount()
    const response = await relay(body)
    assert.equal(response.status, status, JSON.stringify(response.body))
    assert.equal(response.body.error.code, code)
    assert.equal(await relayerTxCount(), before, 'a refused submission costs the relayer nothing')
  }

  // ─── the point of it ──────────────────────────────────────────────────────

  it('executes a signed in-cap spend for an agent that has never held gas, with no token', async () => {
    assert.equal(await h.deployment.publicClient.getBalance({ address: agent }), 0n, 'the agent has no gas')
    assert.equal(await usdcBalance(agent), 0n, 'and no USDC')

    const { status, body } = await relay(await signed(usdc(1)))

    assert.equal(status, 200, JSON.stringify(body))
    assert.equal(body.executed, true)
    assert.ok(body.transactionHash)
    assert.equal(await usdcBalance(agent), usdc(1), 'released to the agent, exactly')
    assert.equal(await usdcBalance(relayer), 0n, 'the relayer never receives funds')
    assert.equal(await nonceOf(agent), 1n)
  })

  it('holds an over-cap signed spend and reports the request id', async () => {
    const { status, body } = await relay(await signed(usdc(11)))

    assert.equal(status, 200)
    assert.equal(body.executed, false)
    assert.equal(body.requestId, '1')

    const pending = await h.request('GET', '/pending/1')
    assert.equal(pending.body.pending.agentName, 'Pricer', 'held for the agent, not the relayer')
  })

  // ─── every refusal is the contract's ──────────────────────────────────────

  it('refuses a replayed signature', async () => {
    const body = await signed(usdc(1))
    assert.equal((await relay(body)).status, 200)

    await assertRefused(body, 400, 'InvalidSignature')
  })

  it('refuses a signature from a key that is not the agent', async () => {
    await assertRefused(await signed(usdc(1), { key: generatePrivateKey() }), 400, 'InvalidSignature')
  })

  it('refuses an amount the agent did not sign', async () => {
    const body = await signed(usdc(1))
    await assertRefused({ ...body, amount: usdc(2).toString() }, 400, 'InvalidSignature')
  })

  it('refuses an expired request', async () => {
    await assertRefused(await signed(usdc(1), { deadline: 1n }), 400, 'SignatureExpired')
  })

  it('rejects a malformed body before touching the chain', async () => {
    const body = await signed(usdc(1))
    await assertRefused({ ...body, amount: 1_000_000 }, 400, 'invalid_body')
  })

  it("refuses a revoked agent's pre-signed spend", async () => {
    const body = await signed(usdc(1))
    assert.equal((await h.request('POST', `/agents/${agentId}/revoke`)).status, 200)

    await assertRefused(body, 409, 'AgentNotActive')
  })
})
