import { formatUnits, hexToString, type Log } from 'viem'
import { rosterAbi } from './chain/abi.js'
import { publicClient, ROSTER_ADDRESS } from './chain/chain.js'

/// Checkpoint 7. Not an endpoint — a persistent watcher on the contract's event stream, so the
/// owner learns about a held payment without refreshing the dashboard.
///
/// It deliberately does no approving. Approval is an owner action that arrives through
/// POST /pending/:requestId/approve; this only notices and announces.

export interface PendingNotice {
  requestId: bigint
  agent: `0x${string}`
  payee: `0x${string}`
  amount: bigint
  purpose: string
  blockNumber: bigint
}

type Notify = (notice: PendingNotice) => void

/// Returns an unwatch function. viem polls the RPC and re-establishes its filter on its own; the
/// `onError` hook is here so a dropped connection is visible in the log rather than silently
/// leaving the roster un-watched.
export function watchPaymentPending(notify: Notify): () => void {
  console.log(`[roster-api] watching ${ROSTER_ADDRESS} for PaymentPending`)

  return publicClient.watchContractEvent({
    address: ROSTER_ADDRESS,
    abi: rosterAbi,
    eventName: 'PaymentPending',
    onError: (error) => console.error('[roster-api] PaymentPending watcher error', error),
    onLogs: (logs) => {
      for (const log of logs as Log[]) {
        const args = (log as unknown as { args: Record<string, unknown> }).args
        if (!args) continue

        notify({
          requestId: args.requestId as bigint,
          agent: args.agent as `0x${string}`,
          payee: args.payee as `0x${string}`,
          amount: args.amount as bigint,
          purpose: decodeMemo(args.memo as `0x${string}` | undefined),
          blockNumber: (log.blockNumber ?? 0n) as bigint,
        })
      }
    },
  })
}

function decodeMemo(memo?: `0x${string}`): string {
  if (!memo || memo === '0x') return ''
  try {
    return hexToString(memo).replace(/\u0000/g, '')
  } catch {
    return ''
  }
}

/// The default sink. A real notification channel (push, email, a websocket to the dashboard) is
/// a product decision that hasn't been made; logging keeps the watcher useful and honest in the
/// meantime, and the demo reads the pending state from the dashboard anyway.
export const logNotice: Notify = (notice) => {
  console.log(
    `[roster-api] PaymentPending #${notice.requestId}: ${formatUnits(notice.amount, 6)} USDC ` +
      `to ${notice.payee}${notice.purpose ? ` — ${notice.purpose}` : ''}`,
  )
}
