import { before, after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { anvilAvailable } from './helpers/anvil.js'
import { startHarness, type Harness } from './helpers/harness.js'

/// The hires endpoints against the real app. The job itself needs a Claude runtime, which the
/// harness deliberately lacks, so its step logic is covered by src/services/hires.test.ts; this
/// covers the routes around it — auth, routing ahead of /agents/:id, and dismissal rules.

const available = await anvilAvailable()

describe('hires', { skip: available ? false : 'anvil not installed — install Foundry' }, () => {
  let h: Harness
  // Imported after the harness has set ROSTER_STORE_FILE, so it writes the harness's temp store.
  let store: typeof import('../src/services/store.js')['store']

  before(async () => {
    h = await startHarness()
    store = (await import('../src/services/store.js')).store
  })

  after(async () => {
    await h?.stop()
  })

  const record = (id: string, status: 'setting-up' | 'failed') => {
    const now = new Date().toISOString()
    return {
      id,
      name: 'Courier',
      role: 'Watch market research',
      perTxCap: '10000',
      perPeriodCap: '100000',
      status,
      ...(status === 'failed' ? { failedAt: 'setting-up' as const, error: 'the agent did not report a wallet' } : {}),
      wallet: '0x1111111111111111111111111111111111111111',
      createdAt: now,
      updatedAt: now,
    }
  }

  it('needs the owner token', async () => {
    assert.equal((await h.request('GET', '/agents/hires', { token: null })).status, 401)
  })

  it('lists no hires on a fresh roster — and is not mistaken for an agent id', async () => {
    const { status, body } = await h.request('GET', '/agents/hires')
    assert.equal(status, 200)
    assert.deepEqual(body.hires, [])
  })

  it('never returns the wallet a hire is setting up', async () => {
    store.putHire(record('hire_inflight', 'setting-up'))

    const { body } = await h.request('GET', '/agents/hires/hire_inflight')
    assert.equal(body.hire.status, 'setting-up')
    assert.doesNotMatch(JSON.stringify(body), /0x[0-9a-fA-F]{40}/)
  })

  it('refuses to dismiss a hire still in progress', async () => {
    const { status, body } = await h.request('DELETE', '/agents/hires/hire_inflight')
    assert.equal(status, 409)
    assert.equal(body.error.code, 'hire_in_progress')
  })

  it('dismisses a failed hire', async () => {
    store.putHire(record('hire_failed', 'failed'))

    assert.equal((await h.request('DELETE', '/agents/hires/hire_failed')).status, 200)
    assert.equal((await h.request('GET', '/agents/hires/hire_failed')).status, 404)
  })

  it('still hires synchronously without a Claude runtime', async () => {
    await h.deployment.mint(h.deployment.roster, 1_000_000n)
    const { status, body } = await h.request('POST', '/agents', {
      body: { name: 'Pricer', role: 'Research', perTxCap: '10000', perPeriodCap: '100000' },
    })
    assert.equal(status, 201, 'no job to wait on, so no 202')
    assert.equal(body.started, false)
  })
})
