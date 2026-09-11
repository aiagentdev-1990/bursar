import { randomUUID } from 'node:crypto'
import { formatUnits, type Address } from 'viem'
import { encodeLabel } from './labels.js'
import { contractErrorName, toApiError } from '../http/errors.js'
import type { HireRecord, HireStatus, StoredAgent } from './store.js'

/// §4.1, run as a background job. POST /agents records the hire and answers at once; this carries
/// it through the steps that wait on the agent:
///
///   starting     → a new Claude agent with the payment skill, and a session on it
///   setting-up   → the skill's setup creates the wallet in the agent's own sandbox; wait for the
///                  address it reports (this is the step that takes minutes)
///   registering  → hire that address on-chain with its caps, then fund it
///   briefing     → tell the agent where its allowance lives — the Roster and the relay — and its task
///   active
///
/// Every step is written to the store as it completes, so a restart resumes a hire from the last
/// one it finished (`resume`). The registering step reads the chain first and skips what is
/// already done, so a resumed hire never registers or funds twice.
///
/// Dependencies are passed in rather than imported, so the step logic is tested with fakes
/// (hires.test.ts); services/hiring.ts wires in the real runtime, chain and store.

export interface HireDeps {
  runtime: {
    startAgentSession(params: { name: string; role: string; briefing: string }): Promise<{
      claudeAgentId: string
      sessionId: string
      traceUrl: string
    }>
    waitForWalletAddress(sessionId: string): Promise<Address>
    sendMessage(sessionId: string, text: string): Promise<void>
  }
  chain: {
    /// False in provisioning-only mode: the agent is set up but nothing is registered.
    enabled: boolean
    rosterAddress: Address
    getAgent(agent: Address): Promise<{ registered: boolean; earmarkedBalance: bigint }>
    hireAgent(agent: Address, perTxCap: bigint, perPeriodCap: bigint, label: string): Promise<unknown>
    fundAgent(agent: Address, amount: bigint): Promise<unknown>
  }
  store: {
    putHire(hire: HireRecord): void
    getHire(id: string): HireRecord | undefined
    listHires(): HireRecord[]
    putAgent(agent: StoredAgent): void
    setSession(wallet: string, sessionId: string): void
  }
  relayUrl: string | undefined
  log?: (line: string) => void
}

export interface HireInput {
  name: string
  role: string
  perTxCap: bigint
  perPeriodCap: bigint
  fundAmount?: bigint
  briefing?: string
}

export const FINISHED: readonly HireStatus[] = ['active', 'failed']

const usd = (baseUnits: string): string => `$${formatUnits(BigInt(baseUnits), 6)}`

export function setupBriefing(hire: Pick<HireRecord, 'name' | 'role'>): string {
  return [
    `You have been hired as ${hire.name}. Your role: ${hire.role}.`,
    '',
    'Before anything else, run the setup in your payment skill and report your wallet address on a',
    'line of its own, exactly as the skill shows:',
    '',
    'WALLET_ADDRESS: 0x...',
    '',
    'Buy nothing yet. You are not on the roster until you are told so.',
  ].join('\n')
}

export function onRosterBriefing(
  hire: Pick<HireRecord, 'perTxCap' | 'perPeriodCap' | 'briefing'>,
  rosterAddress: Address,
  relayUrl: string | undefined,
): string {
  return [
    'You are on the roster. Save these as your skill says:',
    '',
    `Roster contract: ${rosterAddress}`,
    relayUrl
      ? `Relay URL: ${relayUrl}`
      : 'Relay URL: not configured yet. Do not try to buy anything until you are given one.',
    '',
    `Your caps: ${usd(hire.perTxCap)} per transaction, ${usd(hire.perPeriodCap)} per 30 days. Anything`,
    'above either is held for your owner to decide.',
    '',
    hire.briefing ?? 'Introduce yourself in one line, then say what you plan to do first.',
  ].join('\n')
}

/// An owner-readable reason. Contract reverts get the same wording the API gives them elsewhere.
function describe(error: unknown): string {
  if (contractErrorName(error)) return toApiError(error).message
  return error instanceof Error ? error.message : String(error)
}

export function createHireJobs(deps: HireDeps) {
  const inFlight = new Map<string, Promise<HireRecord>>()

  function update(id: string, patch: Partial<HireRecord>): HireRecord {
    const next = { ...deps.store.getHire(id)!, ...patch, updatedAt: new Date().toISOString() }
    deps.store.putHire(next)
    return next
  }

  async function steps(id: string): Promise<HireRecord> {
    let hire = deps.store.getHire(id)!

    if (hire.status === 'starting') {
      // Not idempotent: a restart that lands inside this call can create a second Claude agent.
      // Harmless — nothing on-chain refers to the first one — and a narrow window.
      const started = await deps.runtime.startAgentSession({
        name: hire.name,
        role: hire.role,
        briefing: setupBriefing(hire),
      })
      hire = update(id, { status: 'setting-up', ...started })
    }

    if (hire.status === 'setting-up') {
      const wallet = await deps.runtime.waitForWalletAddress(hire.sessionId!)
      hire = update(id, { status: 'registering', wallet })
    }

    if (hire.status === 'registering') {
      const wallet = hire.wallet as Address
      if (deps.chain.enabled) {
        // Read first, so a hire resumed after these writes landed does not repeat them.
        const before = await deps.chain.getAgent(wallet)
        if (!before.registered) {
          await deps.chain.hireAgent(
            wallet,
            BigInt(hire.perTxCap),
            BigInt(hire.perPeriodCap),
            encodeLabel({ name: hire.name, role: hire.role }),
          )
        }
        hire = update(id, { registered: true })
        if (hire.fundAmount && before.earmarkedBalance === 0n) {
          await deps.chain.fundAgent(wallet, BigInt(hire.fundAmount))
        }
      }

      deps.store.setSession(wallet, hire.sessionId!)
      deps.store.putAgent({
        wallet,
        name: hire.name,
        role: hire.role,
        perTxCap: hire.perTxCap,
        perPeriodCap: hire.perPeriodCap,
        claudeAgentId: hire.claudeAgentId,
        sessionId: hire.sessionId,
        createdAt: hire.createdAt,
      })
      hire = update(id, { status: 'briefing' })
    }

    if (hire.status === 'briefing') {
      await deps.runtime.sendMessage(hire.sessionId!, onRosterBriefing(hire, deps.chain.rosterAddress, deps.relayUrl))
      hire = update(id, {
        status: 'active',
        ...(deps.relayUrl ? {} : { warning: 'RELAY_PUBLIC_URL is not set, so the agent has no relay and cannot spend yet.' }),
      })
    }

    return hire
  }

  /// Runs a hire from wherever it is, once. A second call while it runs joins the first.
  function run(id: string): Promise<HireRecord> {
    const running = inFlight.get(id)
    if (running) return running

    const job = steps(id)
      .catch((error: unknown) => {
        const hire = deps.store.getHire(id)!
        const reason = describe(error)
        deps.log?.(`[roster-api] hire ${id} (${hire.name}) failed while ${hire.status}: ${reason}`)
        return update(id, { status: 'failed', failedAt: hire.status, error: reason })
      })
      .finally(() => inFlight.delete(id))

    inFlight.set(id, job)
    return job
  }

  /// Records the hire and starts it. Returns at once; `done` settles when the job does (tests use
  /// it; the API does not wait on it).
  function start(input: HireInput): { hire: HireRecord; done: Promise<HireRecord> } {
    const now = new Date().toISOString()
    const hire: HireRecord = {
      id: `hire_${randomUUID().replaceAll('-', '').slice(0, 16)}`,
      name: input.name,
      role: input.role,
      perTxCap: input.perTxCap.toString(),
      perPeriodCap: input.perPeriodCap.toString(),
      ...(input.fundAmount ? { fundAmount: input.fundAmount.toString() } : {}),
      ...(input.briefing ? { briefing: input.briefing } : {}),
      status: 'starting',
      createdAt: now,
      updatedAt: now,
    }
    deps.store.putHire(hire)
    return { hire, done: run(hire.id) }
  }

  /// Picks up hires a restart interrupted, each from the last step it completed.
  function resume(): HireRecord[] {
    const unfinished = deps.store.listHires().filter((hire) => !FINISHED.includes(hire.status))
    for (const hire of unfinished) void run(hire.id)
    return unfinished
  }

  return { start, run, resume }
}
