import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  parseEventLogs,
  type Address,
  type Hex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { TEST_ACCOUNT, ANVIL_CHAIN_ID } from './anvil.js'

/// Deploys the *real* compiled artifacts — the same bytecode `forge build` produces and the
/// deploy script ships. Nothing here reimplements the contract.

const here = dirname(fileURLToPath(import.meta.url))
const ARTIFACTS = resolve(here, '../../../../packages/contracts/out')

interface Artifact {
  abi: readonly unknown[]
  bytecode: { object: Hex }
}

function artifact(name: string): Artifact {
  const path = resolve(ARTIFACTS, `${name}.sol/${name}.json`)
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Artifact
  } catch {
    throw new Error(`Missing ${path}. Run \`pnpm contracts:build\` before the integration tests.`)
  }
}

export interface Deployment {
  usdc: Address
  factory: Address
  roster: Address
  owner: Address
  publicClient: ReturnType<typeof createPublicClient>
  walletClient: ReturnType<typeof createWalletClient>
  chain: ReturnType<typeof defineChain>
  /// Mint MockUSDC to any address. Stands in for Bridge Kit delivering to the Roster (§4.6).
  mint(to: Address, amount: bigint): Promise<void>
  /// Fund an address with native gas so it can send transactions.
  fundGas(to: Address): Promise<void>
}

export async function deployRoster(rpcUrl: string): Promise<Deployment> {
  const chain = defineChain({
    id: ANVIL_CHAIN_ID,
    name: 'Anvil',
    nativeCurrency: { name: 'USD Coin', symbol: 'USDC', decimals: 6 },
    rpcUrls: { default: { http: [rpcUrl] } },
  })

  const account = privateKeyToAccount(TEST_ACCOUNT.privateKey)
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) })
  const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) })

  // Fund the deployer explicitly rather than assuming our key is one anvil prefunds. Anvil's
  // prefunded set depends on its mnemonic and version; this works regardless of both.
  await publicClient.request({
    method: 'anvil_setBalance' as never,
    params: [account.address, '0x21E19E0C9BAB2400000'] as never,
  })

  async function deploy(name: string, args: readonly unknown[] = []): Promise<Address> {
    const { abi, bytecode } = artifact(name)
    const hash = await walletClient.deployContract({
      abi: abi as never,
      bytecode: bytecode.object,
      args: args as never,
      account,
      chain,
    })
    const receipt = await publicClient.waitForTransactionReceipt({ hash })
    if (!receipt.contractAddress) throw new Error(`${name} deployment produced no address`)
    return receipt.contractAddress
  }

  const usdc = await deploy('MockUSDC')
  const factory = await deploy('RosterFactory', [usdc])

  // One Roster per team — create the team this test suite operates on.
  const factoryArtifact = artifact('RosterFactory')
  const createHash = await walletClient.writeContract({
    address: factory,
    abi: factoryArtifact.abi as never,
    functionName: 'createRoster',
    args: [TEST_ACCOUNT.address],
    account,
    chain,
  })
  const createReceipt = await publicClient.waitForTransactionReceipt({ hash: createHash })

  const [created] = parseEventLogs({
    abi: factoryArtifact.abi as never,
    eventName: 'RosterCreated',
    logs: createReceipt.logs,
  })
  const roster = (created as unknown as { args: { roster: Address } }).args.roster

  const usdcAbi = artifact('MockUSDC').abi

  return {
    usdc,
    factory,
    roster,
    owner: TEST_ACCOUNT.address,
    publicClient,
    walletClient,
    chain,

    async mint(to, amount) {
      const hash = await walletClient.writeContract({
        address: usdc,
        abi: usdcAbi as never,
        functionName: 'mint',
        args: [to, amount],
        account,
        chain,
      })
      await publicClient.waitForTransactionReceipt({ hash })
    },

    async fundGas(to) {
      await publicClient.request({
        // anvil cheat code — gives a freshly generated agent wallet gas to spend.
        method: 'anvil_setBalance' as never,
        params: [to, '0xDE0B6B3A7640000'] as never,
      })
    },
  }
}

/// USDC has 6 decimals. `usdc(120)` is $120.00 in base units.
export const usdc = (whole: number): bigint => BigInt(whole) * 1_000_000n
