import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

/// Operational state that is not derivable from the chain: which Claude session belongs to which
/// agent, and which Managed Agents Agent config backs which role.
///
/// This is deliberately *not* a mirror of roster data. Names, roles, caps and spend all live
/// on-chain or in the event log (see services/labels.ts for why). If this file is deleted the
/// roster is unaffected — only the link to a running Claude session is lost, and §4.3's
/// post-approval session event is skipped with a warning instead of failing the approval.
///
/// A JSON file rather than a database because there is nothing here worth the operational
/// weight of one, and a hackathon demo has to survive a restart, not a shard rebalance.

/// Overridable so the integration tests get a throwaway path instead of the repo root.
const FILE = process.env.ROSTER_STORE_FILE ?? resolve(process.cwd(), '.roster-store.json')

export interface StoredAgent {
  wallet: string
  name: string
  role: string
  /// USDC base units, as strings — never a float, even in scaffolding.
  perTxCap: string
  perPeriodCap: string
  claudeAgentId?: string
  sessionId?: string
  createdAt: string
}

type Shape = {
  /// agent wallet address (lowercased) → what was provisioned for it.
  ///
  /// In provisioning-only mode this is the roster. Once the contract is wired it stops being a
  /// source of truth for anything the chain knows — caps, spend and active status come from
  /// `getAgent`, and this keeps only what no chain holds.
  agents: Record<string, StoredAgent>
  /// role label → Managed Agents agent id + version
  agentConfigs: Record<string, { id: string; version: number }>
  /// agent wallet address (lowercased) → Claude session id
  sessions: Record<string, string>
  /// agent wallet address (lowercased) → private key. Local wallet provider only; see wallets.ts.
  localKeys: Record<string, string>
}

const EMPTY: Shape = { agents: {}, agentConfigs: {}, sessions: {}, localKeys: {} }

function read(): Shape {
  if (!existsSync(FILE)) return structuredClone(EMPTY)
  try {
    return { ...structuredClone(EMPTY), ...JSON.parse(readFileSync(FILE, 'utf8')) }
  } catch {
    console.warn(`[roster-api] ${FILE} is unreadable; starting from empty operational state.`)
    return structuredClone(EMPTY)
  }
}

function write(state: Shape): void {
  mkdirSync(dirname(FILE), { recursive: true })
  writeFileSync(FILE, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
}

export const store = {
  putAgent(agent: StoredAgent) {
    const state = read()
    state.agents[agent.wallet.toLowerCase()] = agent
    write(state)
  },
  getAgent(wallet: string): StoredAgent | undefined {
    return read().agents[wallet.toLowerCase()]
  },
  listAgents(): StoredAgent[] {
    return Object.values(read().agents).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  },

  getAgentConfig(role: string) {
    return read().agentConfigs[role]
  },
  setAgentConfig(role: string, value: { id: string; version: number }) {
    const state = read()
    state.agentConfigs[role] = value
    write(state)
  },

  getSession(agent: string) {
    return read().sessions[agent.toLowerCase()]
  },
  setSession(agent: string, sessionId: string) {
    const state = read()
    state.sessions[agent.toLowerCase()] = sessionId
    write(state)
  },

  getLocalKey(agent: string) {
    return read().localKeys[agent.toLowerCase()]
  },
  setLocalKey(agent: string, privateKey: string) {
    const state = read()
    state.localKeys[agent.toLowerCase()] = privateKey
    write(state)
  },
  /// Every wallet this service generated a dev key for (lowercased). Includes wallets that were
  /// never registered, or were registered on a Roster since retired.
  localKeyWallets(): string[] {
    return Object.keys(read().localKeys)
  },
}
