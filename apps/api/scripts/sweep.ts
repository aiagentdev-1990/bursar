// Returns USDC left in dev agent wallets to the owner.
//
//   pnpm --filter @roster/api sweep
//
// Why there is anything to sweep: a release (`executeSpend` / `executeSpendFor`) moves USDC into
// the agent's wallet only for the x402 payment that immediately follows it. A real agent makes
// that payment, so its wallet goes back to zero. The seed's first runs released and stopped,
// stranding every amount, and wallets from before 2026-09-11 also hold the gas floats agents used
// to need.
//
// Only wallets whose keys this service generated (WALLET_PROVIDER=local, kept in
// .roster-store.json) can be swept. Each agent signs an EIP-3009 authorization and the relayer
// submits it, so the agents send nothing and need no gas. Dev only.

import { erc20Abi, formatUnits, type Address, type Hex } from 'viem'
import { loadEnv } from '../src/env.js'
import { ownerAccount, publicClient } from '../src/chain/chain.js'
import { store } from '../src/services/store.js'
import { transferWithAuthorization } from './lib/eip3009.js'

const env = loadEnv()
const fmt = (v: bigint): string => `$${formatUnits(v, 6)}`

async function main() {
  if (env.NODE_ENV === 'production') throw new Error('sweep moves funds out of agent wallets; never run it in production.')

  const names = new Map(store.listAgents().map((a) => [a.wallet.toLowerCase(), a.name]))
  const owner = ownerAccount.address
  console.log(`sweeping dev agent wallets to the owner ${owner}\n`)

  let total = 0n
  // Sequential: every authorization is submitted by the one relayer account.
  for (const wallet of store.localKeyWallets()) {
    const address = wallet as Address
    const balance = await publicClient.readContract({
      address: env.USDC_ADDRESS,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [address],
    })
    if (balance === 0n) continue

    const key = store.getLocalKey(address) as Hex
    await transferWithAuthorization(key, owner, balance)
    total += balance
    console.log(`  ${(names.get(wallet) ?? 'unregistered').padEnd(12)} ${address}  ${fmt(balance)}`)
  }

  console.log(total === 0n ? '  nothing to sweep' : `\nreturned ${fmt(total)} to the owner`)
}

main().catch((error) => {
  console.error(`\nsweep failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
