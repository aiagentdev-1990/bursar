import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Hono } from 'hono'
import type { Address, Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { startAnvil, TEST_ACCOUNT, type Anvil } from './anvil.js'
import { deployRoster, type Deployment } from './deploy.js'
import { startBlockscoutStub, type BlockscoutStub } from './blockscout.js'

/// Boots the whole service against a real chain: anvil, the real compiled contracts, the app
/// mounted in-process, and a Blockscout stub over the node's own logs.
///
/// The app reads its configuration at import time, so every environment variable has to be set
/// before `src/app.ts` is first imported — hence the dynamic import below. That ordering is
/// load-bearing; moving the import to the top of the file breaks every test in a confusing way.

export const OWNER_TOKEN = 'integration-test-owner-token-000000'

/// Anvil's well-known account #1. Submits signed spends for POST /relay/spend.
export const RELAYER_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const

export interface Harness {
  app: Hono
  deployment: Deployment
  blockscout: BlockscoutStub
  /// Authenticated request against the mounted app. `token: null` sends no Authorization header.
  request(
    method: string,
    path: string,
    options?: { body?: unknown; token?: string | null },
  ): Promise<{ status: number; body: any }>
  /// The dev-mode private key generated for a hired agent, so a test can spend as that agent.
  agentKey(address: Address): Hex
  stop(): Promise<void>
}

export async function startHarness(): Promise<Harness> {
  // Anything started here has to be torn down even when a later step throws. A leaked node or
  // stub server keeps the event loop alive, so the suite hangs to its timeout and reports that
  // instead of the real error — which is exactly what happened while writing these tests.
  const cleanups: Array<() => void | Promise<void>> = []
  const unwind = async () => {
    for (const cleanup of cleanups.reverse()) await cleanup()
  }

  let anvil!: Anvil
  let deployment!: Deployment
  let blockscout!: BlockscoutStub
  let stateDir!: string

  try {
    anvil = await startAnvil()
    cleanups.push(() => anvil.stop())

    deployment = await deployRoster(anvil.rpcUrl)

    blockscout = await startBlockscoutStub({ rpcUrl: anvil.rpcUrl })
    cleanups.push(() => blockscout.stop())

    stateDir = mkdtempSync(join(tmpdir(), 'roster-api-test-'))
    cleanups.push(() => rmSync(stateDir, { recursive: true, force: true }))
  } catch (error) {
    await unwind()
    throw error
  }

  const storeFile = join(stateDir, 'store.json')

  // The relayer pays gas for signed spends. A different account from the owner, as in production.
  try {
    await deployment.fundGas(privateKeyToAccount(RELAYER_KEY).address)
  } catch (error) {
    await unwind()
    throw error
  }

  Object.assign(process.env, {
    RELAYER_PRIVATE_KEY: RELAYER_KEY,
    // The harness never binds a port; app.ts only reports it on /health.
    PORT: '8787',
    ARC_TESTNET_RPC_URL: anvil.rpcUrl,
    ARC_CHAIN_ID: String(anvil.chainId),
    USDC_ADDRESS: deployment.usdc,
    ROSTER_CONTRACT_ADDRESS: deployment.roster,
    ROSTER_FACTORY_ADDRESS: deployment.factory,
    OWNER_PRIVATE_KEY: TEST_ACCOUNT.privateKey,
    BLOCKSCOUT_API_URL: blockscout.url,
    OWNER_API_TOKEN: OWNER_TOKEN,
    WALLET_PROVIDER: 'local',
    ROSTER_STORE_FILE: storeFile,
    NODE_ENV: 'test',
  })
  // Deliberately unset: the Claude path is checkpoint 4, and one of the behaviours under test is
  // that a hire still registers on-chain and enforces its caps when the runtime is unavailable.
  delete process.env.ANTHROPIC_API_KEY

  let app: Hono
  try {
    const { createApp } = await import('../../src/app.js')
    app = createApp()
  } catch (error) {
    await unwind()
    throw error
  }

  return {
    app,
    deployment,
    blockscout,

    async request(method, path, options = {}) {
      const token = options.token === undefined ? OWNER_TOKEN : options.token
      const headers: Record<string, string> = {}
      if (token !== null) headers.authorization = `Bearer ${token}`
      if (options.body !== undefined) headers['content-type'] = 'application/json'

      const response = await app.fetch(
        new Request(`http://test${path}`, {
          method,
          headers,
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
        }),
      )

      const text = await response.text()
      let body: unknown
      try {
        body = text ? JSON.parse(text) : undefined
      } catch {
        body = text
      }

      return { status: response.status, body }
    },

    agentKey(address) {
      if (!existsSync(storeFile)) throw new Error('no store file — was an agent hired?')
      const keys = JSON.parse(readFileSync(storeFile, 'utf8')).localKeys as Record<string, Hex>
      const key = keys[address.toLowerCase()]
      if (!key) throw new Error(`no dev key stored for ${address}`)
      return key
    },

    stop: unwind,
  }
}

/// The API never returns wallet addresses (§4.1), but a test needs one to act *as* an agent.
/// Recovered from the AgentRegistered event rather than from a response body, which is exactly
/// where the dashboard would not be able to get it either.
export async function agentAddressFor(harness: Harness, agentId: string): Promise<Address> {
  const { publicClient, roster } = harness.deployment
  const logs = await publicClient.getLogs({
    address: roster,
    event: {
      type: 'event',
      name: 'AgentRegistered',
      inputs: [
        { name: 'agent', type: 'address', indexed: true },
        { name: 'perTxCap', type: 'uint256', indexed: false },
        { name: 'perPeriodCap', type: 'uint256', indexed: false },
        { name: 'role', type: 'string', indexed: false },
      ],
    },
    fromBlock: 0n,
  })

  const { agentId: computeId } = await import('../../src/services/ids.js')
  for (const log of logs) {
    const address = (log as unknown as { args: { agent: Address } }).args.agent
    if (computeId(address) === agentId) return address
  }

  throw new Error(`no agent on chain matching id ${agentId}`)
}

export const asAccount = (key: Hex) => privateKeyToAccount(key)
