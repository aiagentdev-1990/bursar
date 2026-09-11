// Empties a Roster back to its owner: the whole balance is withdrawn. For retiring a Roster
// before a redeploy, or resetting before a rehearsal.
//
//   pnpm --filter @roster/api drain
//   ROSTER_CONTRACT_ADDRESS=0x… pnpm --filter @roster/api drain     # a Roster other than .env's
//
// One owner call, `withdrawTreasury`, so this can take nothing the contract would not let the
// owner take by hand. Every agent spends from that one balance, so there is nothing per agent to
// release first.
//
// Not touched: USDC already released into agent wallets. That is the agents' balance, not the
// Roster's — `pnpm --filter @roster/api sweep` returns it from dev (local-key) wallets.

import { formatUnits } from 'viem'
import { contractEnabled, ownerAccount, ROSTER_ADDRESS } from '../src/chain/chain.js'
import * as contract from '../src/chain/roster.js'
import { fetchRosterEvents, openRequestsFrom } from '../src/services/blockscout.js'

const fmt = (v: bigint): string => `$${formatUnits(v, 6)}`

async function main() {
  if (!contractEnabled()) throw new Error('ROSTER_CONTRACT_ADDRESS is not set.')

  const owner = await contract.getOwner()
  if (owner.toLowerCase() !== ownerAccount.address.toLowerCase()) {
    throw new Error(`OWNER_PRIVATE_KEY signs as ${ownerAccount.address}, but the Roster's owner is ${owner}.`)
  }

  console.log(`draining ${ROSTER_ADDRESS} to its owner ${owner}\n`)

  const balance = await contract.getBalance()
  if (balance > 0n) {
    const hash = await contract.withdrawTreasury(owner, balance)
    console.log(`withdrew ${fmt(balance)} to the owner (${hash})`)
  } else {
    console.log('nothing to withdraw')
  }

  console.log(`roster now holds ${fmt(await contract.getBalance())}`)

  const open = openRequestsFrom(await fetchRosterEvents())
  if (open.length > 0) {
    console.log(`${open.length} held request(s) still open — the balance is empty, so an approval would revert.`)
  }
}

main().catch((error) => {
  console.error(`\ndrain failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
