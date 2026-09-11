import type { Context, ErrorHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { BaseError, ContractFunctionRevertedError } from 'viem'

/// A failure the caller caused, with a stable machine-readable code.
export class ApiError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 501 | 502,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

/// The contract's custom errors, mapped to something an owner-facing UI can act on. Anything
/// not in this table is a bug in this service, not a user mistake, and surfaces as a 502.
const CONTRACT_ERRORS: Record<string, { status: 400 | 403 | 404 | 409; message: string }> = {
  NotOwner: { status: 403, message: 'This roster is owned by a different account.' },
  NotAgent: { status: 404, message: 'That agent is not on this roster.' },
  UnknownAgent: { status: 404, message: 'That agent is not on this roster.' },
  AgentNotActive: { status: 409, message: 'That agent has been revoked.' },
  AgentAlreadyRegistered: { status: 409, message: 'That wallet is already on the roster.' },
  RequestNotOpen: { status: 409, message: 'That request has already been approved or rejected.' },
  InsufficientEarmarkedBalance: {
    status: 409,
    message: "The agent's earmarked balance no longer covers this amount.",
  },
  InsufficientTreasury: {
    status: 400,
    message: "The roster doesn't hold enough USDC to earmark that much. Fund it first.",
  },
  ZeroCap: { status: 400, message: 'Both caps must be greater than zero.' },
  ZeroAddress: { status: 400, message: 'A zero address was supplied.' },
  AlreadyInitialized: { status: 409, message: 'That roster is already initialized.' },
  // executeSpendFor — the relayed path. The agent re-signs; nothing on the roster is wrong.
  SignatureExpired: { status: 400, message: "The agent's signed spend request has expired." },
  InvalidSignature: {
    status: 400,
    message: "The spend request isn't validly signed by that agent for this roster, or was already used.",
  },
}

/// viem buries the decoded custom error a few layers down a revert.
export function contractErrorName(error: unknown): string | undefined {
  if (!(error instanceof BaseError)) return undefined
  const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError)
  return reverted instanceof ContractFunctionRevertedError ? reverted.data?.errorName : undefined
}

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error

  const name = contractErrorName(error)
  if (name) {
    const mapped = CONTRACT_ERRORS[name]
    if (mapped) return new ApiError(mapped.status, name, mapped.message)
    return new ApiError(502, name, `The contract rejected this call: ${name}.`)
  }

  return new ApiError(502, 'upstream_failure', 'The call could not be completed.')
}

export const onError: ErrorHandler = (error, c: Context) => {
  if (error instanceof HTTPException) return error.getResponse()

  const api = toApiError(error)

  // A 502 means this service or a dependency broke, so keep the detail in the log.
  if (api.status === 502) console.error('[roster-api]', error)

  return c.json({ error: { code: api.code, message: api.message } }, api.status)
}
