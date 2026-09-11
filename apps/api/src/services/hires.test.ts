import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Address } from 'viem'
import { createHireJobs, type HireDeps, type HireInput } from './hires.js'
import type { HireRecord } from './store.js'

/// The hire job's step logic against fakes — no Claude, no chain. What matters is the order of
/// effects (nothing on-chain before the agent reports a wallet), that a failure says where it
/// stopped, and that a resumed hire never registers twice.

const WALLET = '0x1111111111111111111111111111111111111111' as Address
const ROSTER = '0x2222222222222222222222222222222222222222' as Address

const INPUT: HireInput = {
  name: 'Courier',
  role: 'Watch market research',
  perTxCap: 10_000n,
  perPeriodCap: 100_000n,
  briefing: 'Buy the market price for ref. 145.022.',
}

function setup(over: {
  wallet?: () => Promise<Address>
  alreadyRegistered?: boolean
  relayUrl?: string | undefined
  hireFails?: Error
} = {}) {
  const calls: string[] = []
  const hires = new Map<string, HireRecord>()

  const deps: HireDeps = {
    runtime: {
      async startAgentSession(params) {
        calls.push(`session ${params.name}`)
        return { claudeAgentId: 'agent_1', sessionId: 'sesn_1', traceUrl: 'https://trace.example/sesn_1' }
      },
      waitForWalletAddress:
        over.wallet ??
        (async () => {
          calls.push('wallet')
          return WALLET
        }),
      async sendMessage(_sessionId, text) {
        calls.push(`brief ${text}`)
      },
    },
    chain: {
      enabled: true,
      rosterAddress: ROSTER,
      async getAgent() {
        return { registered: over.alreadyRegistered ?? false }
      },
      async hireAgent(agent, perTx, perPeriod, label) {
        if (over.hireFails) throw over.hireFails
        calls.push(`hire ${agent} ${perTx} ${perPeriod} ${label}`)
      },
    },
    store: {
      putHire: (hire) => void hires.set(hire.id, structuredClone(hire)),
      getHire: (id) => hires.get(id),
      listHires: () => [...hires.values()],
      putAgent: () => void calls.push('remember'),
      setSession: (_wallet, sessionId) => void calls.push(`link ${sessionId}`),
    },
    relayUrl: 'relayUrl' in over ? over.relayUrl : 'https://relay.example',
  }

  return { jobs: createHireJobs(deps), calls, hires }
}

const at = (calls: string[], prefix: string) => calls.findIndex((c) => c.startsWith(prefix))

test('answers at once, then runs the hire to active in order', async () => {
  const { jobs, calls } = setup()
  const { hire, done } = jobs.start(INPUT)

  assert.equal(hire.status, 'starting', 'the caller gets the hire before any step has run')

  const final = await done
  assert.equal(final.status, 'active')
  assert.equal(final.registered, true)
  assert.equal(final.traceUrl, 'https://trace.example/sesn_1')

  assert.ok(at(calls, 'session') < at(calls, 'wallet'), 'the agent exists before its wallet is awaited')
  assert.ok(at(calls, 'wallet') < at(calls, 'hire'), 'nothing is registered before the agent reports a wallet')
  assert.ok(at(calls, 'hire') < at(calls, 'brief'), 'told where its allowance lives only once it has one')

  assert.ok(calls.includes(`hire ${WALLET} 10000 100000 Courier|Watch market research`), 'registered with the reported wallet and caps')
  const brief = calls.find((c) => c.startsWith('brief'))!
  assert.match(brief, new RegExp(ROSTER))
  assert.match(brief, /https:\/\/relay\.example/)
  assert.match(brief, /shares/, 'told it spends from the shared balance')
  assert.match(brief, /Buy the market price/)
})

test('a setup failure fails the hire with nothing on-chain, and says where it stopped', async () => {
  const { jobs, calls } = setup({
    wallet: async () => {
      throw new Error('the agent did not report a wallet within 600s')
    },
  })

  const final = await jobs.start(INPUT).done

  assert.equal(final.status, 'failed')
  assert.equal(final.failedAt, 'setting-up')
  assert.notEqual(final.registered, true)
  assert.match(final.error!, /did not report a wallet/)
  assert.equal(at(calls, 'hire'), -1, 'nothing registered')
  assert.equal(at(calls, 'brief'), -1, 'the agent is never told it is on the roster')
})

test('a registration failure is reported against that step, still unregistered', async () => {
  const { jobs } = setup({ hireFails: new Error('rpc timeout') })

  const final = await jobs.start(INPUT).done

  assert.equal(final.status, 'failed')
  assert.equal(final.failedAt, 'registering')
  assert.notEqual(final.registered, true)
})

test('a hire resumed after a restart does not register twice', async () => {
  // Interrupted after hireAgent landed, before the step was recorded.
  const { jobs, calls, hires } = setup({ alreadyRegistered: true })
  const now = new Date().toISOString()
  hires.set('hire_resumed', {
    id: 'hire_resumed',
    name: 'Courier',
    role: 'Watch market research',
    perTxCap: '10000',
    perPeriodCap: '100000',
    status: 'registering',
    sessionId: 'sesn_1',
    wallet: WALLET,
    createdAt: now,
    updatedAt: now,
  })

  const resumed = jobs.resume()
  assert.deepEqual(resumed.map((h) => h.id), ['hire_resumed'])

  const final = await jobs.run('hire_resumed')
  assert.equal(final.status, 'active')
  assert.equal(at(calls, 'hire'), -1, 'already registered — not registered again')
  assert.notEqual(at(calls, 'brief'), -1, 'and the agent is still briefed')
})

test('resume leaves finished hires alone', () => {
  const { jobs, hires } = setup()
  const now = new Date().toISOString()
  const base = { name: 'X', role: 'Y', perTxCap: '1', perPeriodCap: '1', createdAt: now, updatedAt: now }
  hires.set('hire_a', { ...base, id: 'hire_a', status: 'active' })
  hires.set('hire_b', { ...base, id: 'hire_b', status: 'failed' })

  assert.deepEqual(jobs.resume(), [])
})

test('without a relay URL the agent is told not to buy, and the hire says so', async () => {
  const { jobs, calls } = setup({ relayUrl: undefined })

  const final = await jobs.start(INPUT).done

  assert.equal(final.status, 'active')
  assert.match(final.warning!, /RELAY_PUBLIC_URL/)
  assert.match(calls.find((c) => c.startsWith('brief'))!, /not configured yet/)
})
