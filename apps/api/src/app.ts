// Roster backend — owner-authenticated, with one exception: POST /relay/spend, which agents
// call and which is authorized by the agent's own EIP-712 signature, not a token. Everything
// else is owner-only; an agent otherwise talks to the contract and the x402 facilitator
// directly. See docs/TECH-DESIGN.md §6.
//
//   POST   /relay/spend                   UNAUTHENTICATED — submits an agent's signed
//                                         executeSpendFor and pays its gas (DECISIONS 2026-09-11)
//   POST   /agents                        hire — wallet + hireAgent + Claude agent/env/session (§4.1)
//                                         (one Roster per team; RosterFactory.createRoster deploys it)
//   GET    /agents                        roster overview
//   GET    /agents/:id                    detail
//   PATCH  /agents/:id/caps               updateCaps
//   POST   /agents/:id/revoke             revokeAgent (§4.4)
//   GET    /agents/:id/activity           Blockscout proxy (§4.5)
//   POST   /agents/:id/funding-schedule   Bridge Kit payroll (§4.6) — 501 until checkpoint 10
//   GET    /pending                       all open pending requests
//   GET    /pending/:requestId            one request's detail
//   POST   /pending/:requestId/approve    approvePending, THEN the Claude session-resume event (§4.3)
//   POST   /pending/:requestId/reject     rejectPending
//   GET    /activity                      whole-roster feed (§4.5)
//   GET    /treasury                      the shared balance every agent spends from
//   POST   /treasury/deposit              "add money" — owner wallet → Roster (§4.6, one-off)
//   POST   /treasury/withdraw             withdrawTreasury, to the owner
//
// Plus, not an endpoint: the PaymentPending listener in listener.ts (checkpoint 7).

import { Hono } from 'hono'
import { loadEnv } from './env.js'
import { onError } from './http/errors.js'
import { requireOwner } from './http/auth.js'
import { agents, nameLookup } from './routes/agents.js'
import { pending } from './routes/pending.js'
import { treasury } from './routes/treasury.js'
import { relay } from './routes/relay.js'
import { fetchRosterEvents, agentAddressesFrom } from './services/blockscout.js'
import { toActivityView } from './services/view.js'
import * as contract from './chain/roster.js'

/// Built as a function rather than a module-level singleton so the integration tests can mount
/// it with `app.fetch(...)` — no port to bind, no watcher to tear down, and the same routing
/// and middleware the real process uses.
export function createApp() {
  const env = loadEnv()
  const app = new Hono()

  app.onError(onError)

  /// Unauthenticated on purpose — a health check that requires a secret cannot be used by the
  /// thing that needs it. It reports no roster data.
  app.get('/health', (c) =>
    c.json({ ok: true, chainId: env.ARC_CHAIN_ID, roster: env.ROSTER_CONTRACT_ADDRESS }),
  )

  app.use('/agents/*', requireOwner)
  app.use('/pending/*', requireOwner)
  app.use('/treasury', requireOwner)
  app.use('/treasury/*', requireOwner)
  app.use('/activity', requireOwner)

  app.route('/agents', agents)
  app.route('/pending', pending)
  app.route('/treasury', treasury)

  // No requireOwner — the signature is the auth. See routes/relay.ts.
  app.route('/relay', relay)

  app.get('/activity', async (c) => {
    const events = await fetchRosterEvents()
    const infos = await contract.getAgents(agentAddressesFrom(events))
    const nameFor = nameLookup(infos)

    return c.json({ activity: events.map((event) => toActivityView(event, nameFor)) })
  })

  return app
}
