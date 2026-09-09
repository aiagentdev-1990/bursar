// Roster backend — owner-authenticated only. Agents never call these endpoints;
// an agent's payment tool talks to the contract and the x402 facilitator directly
// with its own wallet. See docs/TECH-DESIGN.md §6.
//
//   POST   /agents                        hire — wallet + hireAgent + Claude agent/env/session (§4.1)
//                                         (one Roster per team; RosterFactory.createRoster deploys it)
//   GET    /agents                        roster overview
//   GET    /agents/:id                    detail
//   PATCH  /agents/:id/caps               updateCaps
//   POST   /agents/:id/revoke             revokeAgent (§4.4)
//   POST   /agents/:id/fund               fundAgent (§4.6, one-off)
//   GET    /agents/:id/activity           Blockscout proxy (§4.5)
//   POST   /agents/:id/funding-schedule   Bridge Kit payroll (§4.6) — 501 until checkpoint 10
//   GET    /pending                       all open pending requests
//   GET    /pending/:requestId            one request's detail
//   POST   /pending/:requestId/approve    approvePending, THEN the Claude session-resume event (§4.3)
//   POST   /pending/:requestId/reject     rejectPending
//   GET    /activity                      whole-roster feed (§4.5)
//
// Plus, not an endpoint: the PaymentPending listener in listener.ts (checkpoint 7).

import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { loadEnv } from './env.js'
import { onError } from './http/errors.js'
import { requireOwner } from './http/auth.js'
import { agents, nameLookup } from './routes/agents.js'
import { pending } from './routes/pending.js'
import { fetchRosterEvents, agentAddressesFrom } from './services/blockscout.js'
import { toActivityView } from './services/view.js'
import * as contract from './chain/roster.js'
import { watchPaymentPending, logNotice } from './listener.js'

const env = loadEnv()
const app = new Hono()

app.onError(onError)

/// Unauthenticated on purpose — a health check that requires a secret cannot be used by the
/// thing that needs it. It reports no roster data.
app.get('/health', (c) => c.json({ ok: true, chainId: env.ARC_CHAIN_ID, roster: env.ROSTER_CONTRACT_ADDRESS }))

app.use('/agents/*', requireOwner)
app.use('/pending/*', requireOwner)
app.use('/activity', requireOwner)

app.route('/agents', agents)
app.route('/pending', pending)

app.get('/activity', async (c) => {
  const events = await fetchRosterEvents()
  const infos = await contract.getAgents(agentAddressesFrom(events))
  const nameFor = nameLookup(infos)

  return c.json({ activity: events.map((event) => toActivityView(event, nameFor)) })
})

const unwatch = watchPaymentPending(logNotice)

const server = serve({ fetch: app.fetch, port: env.PORT })
console.log(`roster api on :${env.PORT} — roster ${env.ROSTER_CONTRACT_ADDRESS} on chain ${env.ARC_CHAIN_ID}`)

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    unwatch()
    server.close(() => process.exit(0))
  })
}
