import * as contract from '../chain/roster.js'
import { contractEnabled, ROSTER_ADDRESS } from '../chain/chain.js'
import { loadEnv } from '../env.js'
import { startAgentSession, sendMessage, waitForWalletAddress } from './agentRuntime.js'
import { createHireJobs } from './hires.js'
import { store } from './store.js'

/// The hire job runner wired to the real Claude runtime, chain and store. The logic lives in
/// hires.ts; this is only the wiring.

/// Nothing holds an HTTP request open any more, so setup can take as long as a slow sandbox needs.
const SETUP_TIMEOUT_MS = 10 * 60_000

export const hireJobs = createHireJobs({
  runtime: {
    startAgentSession,
    waitForWalletAddress: (sessionId) => waitForWalletAddress(sessionId, SETUP_TIMEOUT_MS),
    sendMessage,
  },
  chain: {
    enabled: contractEnabled(),
    rosterAddress: ROSTER_ADDRESS,
    getAgent: contract.getAgent,
    hireAgent: contract.hireAgent,
    fundAgent: contract.fundAgent,
  },
  store,
  relayUrl: loadEnv().RELAY_PUBLIC_URL,
  log: (line) => console.error(line),
})
