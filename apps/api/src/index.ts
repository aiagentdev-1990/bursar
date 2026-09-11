// Process entrypoint: binds the port and starts the PaymentPending watcher (checkpoint 7).
// The app itself is in app.ts, so tests can mount it without either.

import { serve } from '@hono/node-server'
import { createApp } from './app.js'
import { loadEnv } from './env.js'
import { watchPaymentPending, logNotice } from './listener.js'
import { hireJobs } from './services/hiring.js'

const env = loadEnv()
const unwatch = watchPaymentPending(logNotice)

const server = serve({ fetch: createApp().fetch, port: env.PORT })
console.log(`roster api on :${env.PORT} — roster ${env.ROSTER_CONTRACT_ADDRESS} on chain ${env.ARC_CHAIN_ID}`)

// Hires a restart (or a redeploy) interrupted pick up from their last completed step.
const resumed = hireJobs.resume()
if (resumed.length > 0) {
  console.log(`[roster-api] resuming ${resumed.length} hire(s): ${resumed.map((h) => `${h.name} (${h.status})`).join(', ')}`)
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    unwatch()
    server.close(() => process.exit(0))
  })
}
