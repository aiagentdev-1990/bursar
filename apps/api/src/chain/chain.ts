import { createPublicClient, createWalletClient, defineChain, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { loadEnv } from '../env.js'

const env = loadEnv()

/// USDC is Arc's native gas asset, so the chain's "native currency" is USDC at 6 decimals —
/// not an 18-decimal ether. Getting this wrong makes every gas estimate read wrong by 1e12.
export const arcTestnet = defineChain({
  id: env.ARC_CHAIN_ID,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USD Coin', symbol: 'USDC', decimals: 6 },
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

export const ROSTER_ADDRESS = env.ROSTER_CONTRACT_ADDRESS
