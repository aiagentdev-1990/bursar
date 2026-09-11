// Empties a Roster back to its owner: every agent's earmark is defunded, then the whole balance
// is withdrawn. For retiring a Roster before a redeploy, or resetting before a rehearsal.
//
//   pnpm --filter @roster/api drain
//   ROSTER_CONTRACT_ADDRESS=0x… pnpm --filter @roster/api drain     # a Roster other than .env's
//
// Only the contract's own owner paths are used — `defundAgent`, then `withdrawTreasury` — so
// this can take nothing the contract would not let the owner take by hand. Agents are listed
// from the event log (the contract deliberately has no enumeration); the loop over them is here,
// off-chain, never in the contract.
//
// Not touched: USDC already released into agent wallets. That is the agents' balance, not the
// Roster's — `pnpm --filter @roster/api sweep` returns it from dev (local-key) wallets.

import { formatUnits } from 'viem'
import { contractEnabled, ownerAccount, ROSTER_ADDRESS } from '../src/chain/chain.js'
import * as contract from '../src/chain/roster.js'
import { fetchRosterEvents, agentAddressesFrom, openRequestsFrom } from '../src/services/blockscout.js'
import { decodeLabel } from '../src/services/labels.js'

const fmt = (v: bigint): string => `$${formatUnits(v, 6)}`

async function main() {
  if (!contractEnabled()) throw new Error('ROSTER_CONTRACT_ADDRESS is not set.')

  const owner = await contract.getOwner()
  if (owner.toLowerCase() !== ownerAccount.address.toLowerCase()) {
    throw new Error(`OWNER_PRIVATE_KEY signs as ${ownerAccount.address}, but the Roster's owner is ${owner}.`)
  }

  console.log(`draining ${ROSTER_ADDRESS} to its owner ${owner}\n`)

  const events = await fetchRosterEvents()
  const agents = agentAddressesFrom(events)

  // Sequential: every call is signed by the one owner account.
  for (const agent of agents) {
    const info = await contract.getAgent(agent)
    const name = decodeLabel(info.role).name || agent
    if (info.earmarkedBalance === 0n) {
      console.log(`  ${name.padEnd(10)} nothing earmarked`)
      continue
    }
    await contract.defundAgent(agent, info.earmarkedBalance)
    console.log(`  ${name.padEnd(10)} defunded ${fmt(info.earmarkedBalance)}`)
  }

  const unallocated = await contract.getUnallocatedTreasury()
  if (unallocated > 0n) {
    const hash = await contract.withdrawTreasury(owner, unallocated)
    console.log(`\nwithdrew ${fmt(unallocated)} to the owner (${hash})`)
  } else {
    console.log('\nnothing left to withdraw')
  }

  const [earmarked, left] = await Promise.all([contract.getTotalEarmarked(), contract.getUnallocatedTreasury()])
  console.log(`roster now holds ${fmt(earmarked + left)}`)

  const open = openRequestsFrom(events)
  if (open.length > 0) {
    console.log(`${open.length} held request(s) still open — unfunded now, so an approval would revert.`)
  }
}

main().catch((error) => {
  console.error(`\ndrain failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
