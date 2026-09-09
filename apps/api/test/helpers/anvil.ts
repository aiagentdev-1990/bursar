import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'

/// A real EVM node, not a mock. The point of these tests is the seam between this service and
/// the contract — RPC encoding, receipt waiting, custom-error decoding, event decoding — and a
/// mocked chain would assert that our mock behaves like our code expects, which is worth nothing.

export interface Anvil {
  rpcUrl: string
  chainId: number
  stop(): void
}

/// anvil's first prefunded account. A well-known test key; it controls nothing real.
export const TEST_ACCOUNT = {
  address: '0xDb3f3d6D3875894e66Bd3a9B46D1CfD539a03D85' as const,
  privateKey: '0xac0955bb98645cd8bcb26bdd0ea60d29ba2ff9fda07e0b0e40e0bfd35a2c0f57' as const,
}

export const ANVIL_CHAIN_ID = 31337

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (typeof address === 'string' || address === null) {
        reject(new Error('could not determine a free port'))
        return
      }
      const { port } = address
      server.close(() => resolve(port))
    })
  })
}

async function waitForRpc(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
      })
      if (response.ok) return
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 100))
  }

  throw new Error(`anvil did not become ready at ${url} within ${timeoutMs}ms`)
}

/// Each test file gets its own node on its own port, so files can run in parallel without
/// sharing chain state.
export async function startAnvil(): Promise<Anvil> {
  const port = await freePort()

  let child: ChildProcess
  try {
    child = spawn('anvil', ['--port', String(port), '--silent'], { stdio: 'ignore' })
  } catch {
    throw new Error('anvil is not installed. These tests need Foundry: https://getfoundry.sh')
  }

  child.on('error', () => {
    /* surfaced by waitForRpc's timeout below */
  })

  // Unref'd so a leaked node can never hold the test process open — a hung suite is far worse
  // to debug than a failed one.
  child.unref()

  const rpcUrl = `http://127.0.0.1:${port}`
  try {
    await waitForRpc(rpcUrl, 15_000)
  } catch (error) {
    child.kill('SIGKILL')
    throw error
  }

  return {
    rpcUrl,
    chainId: ANVIL_CHAIN_ID,
    stop: () => {
      child.kill('SIGKILL')
    },
  }
}

export async function anvilAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = spawn('anvil', ['--version'], { stdio: 'ignore' })
    probe.on('error', () => resolve(false))
    probe.on('exit', (code) => resolve(code === 0))
  })
}
