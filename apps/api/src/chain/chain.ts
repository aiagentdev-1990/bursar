import { createPublicClient, createWalletClient, defineChain, http } from 'viem'
import { arcTestnet as viemArcTestnet } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'
import { loadEnv } from '../env.js'

const env = loadEnv()

/// Two USDC decimal counts coexist on Arc and they are not the same number:
///
///   the native gas asset is USDC at **18** decimals (fees are quoted in wei-scale units),
///   the ERC-20 predeploy at 0x3600…0000 is USDC at **6** decimals (what agents actually spend).
///
/// Every amount in this service is the 6-decimal kind. `nativeCurrency` below describes only the
/// gas asset, which is why it says 18. Use viem's own definition rather than hand-rolling one —
/// it also carries the canonical RPCs, the ArcScan explorer, and the Multicall3 deployment.
export const arcTestnet =
  env.ARC_CHAIN_ID === viemArcTestnet.id
    ? { ...viemArcTestnet, rpcUrls: { default: { http: [env.ARC_TESTNET_RPC_URL] } } }
    : // A local node (anvil) for the integration tests. Same native-decimal shape so the tests
      // exercise the same assumptions as production.
      defineChain({
        id: env.ARC_CHAIN_ID,
        name: `Local chain ${env.ARC_CHAIN_ID}`,
        nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
        rpcUrls: { default: { http: [env.ARC_TESTNET_RPC_URL] } },
        testnet: true,
      })

export const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(env.ARC_TESTNET_RPC_URL),
})

/// Signs the owner's transactions only. See the note on OWNER_PRIVATE_KEY in env.ts.
export const ownerAccount = privateKeyToAccount(env.OWNER_PRIVATE_KEY)

export const ownerClient = createWalletClient({
  account: ownerAccount,
  chain: arcTestnet,
  transport: http(env.ARC_TESTNET_RPC_URL),
})

/// Submits agents' signed `executeSpendFor` calls and nothing else. See RELAYER_PRIVATE_KEY in
/// env.ts for why this is not the owner key. Undefined when no relayer is configured.
export const relayerAccount = env.RELAYER_PRIVATE_KEY ? privateKeyToAccount(env.RELAYER_PRIVATE_KEY) : undefined

export const relayerClient = relayerAccount
  ? createWalletClient({ account: relayerAccount, chain: arcTestnet, transport: http(env.ARC_TESTNET_RPC_URL) })
  : undefined

/// Undefined in provisioning-only mode. `contractEnabled()` is the guard; anything reaching for
/// this address without checking will fail loudly rather than silently read address zero.
export const ROSTER_ADDRESS = env.ROSTER_CONTRACT_ADDRESS as `0x${string}`

export const contractEnabled = (): boolean => env.ROSTER_CONTRACT_ADDRESS !== undefined
