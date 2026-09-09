// Roster backend — owner-authenticated only. Agents never call these endpoints;
// an agent's payment tool talks to the contract and the x402 facilitator directly
// with its own wallet. See docs/TECH-DESIGN.md §6.
//
// Endpoints to implement (checkpoint 6):
//   POST   /agents                        hire — Privy wallet + hireAgent + Claude agent/env/session (§4.1)
//                                         (one Roster per team; RosterFactory.createRoster deploys it)
//   GET    /agents                        roster overview
//   GET    /agents/:id                    detail
//   PATCH  /agents/:id/caps               updateCaps
//   POST   /agents/:id/revoke             revokeAgent (§4.4)
//   GET    /agents/:id/activity           Blockscout proxy (§4.5)
//   GET    /pending                       all open pending requests
//   POST   /pending/:requestId/approve    approvePending, THEN the Claude session-resume event (§4.3)
//   POST   /pending/:requestId/reject     rejectPending
//   POST   /agents/:id/funding-schedule   Bridge Kit payroll (§4.6)
//
// Plus, not an endpoint: a persistent PaymentPending event listener (checkpoint 7).

import { serve } from '@hono/node-server'
import { Hono } from 'hono'

const app = new Hono()

app.get('/health', (c) => c.json({ ok: true, chainId: 5042002 }))

const port = Number(process.env.PORT ?? 8787)
serve({ fetch: app.fetch, port })
console.log(`roster api on :${port}`)
