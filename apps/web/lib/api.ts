// Server-side only. The dashboard never talks to the chain and never holds a key: it asks
// apps/api, which reads live per-agent state from the contract (`getAgent`) and history from
// ArcScan's Blockscout API (TECH-DESIGN.md §4.5). The owner token is read here, on the Next
// server, and never reaches the browser — nothing in this file may be imported by a
// 'use client' component. Mutations go through server actions for the same reason.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/// The repo keeps one `.env`, at the root, and `next dev` runs with apps/web as its cwd. Only
/// the keys the dashboard needs are kept from it; the private keys in that file are never
/// retained by this process.
const WANTED = new Set(['OWNER_API_TOKEN', 'ROSTER_API_URL', 'PORT'])
let rootEnv: Record<string, string> | undefined

function fromRootEnv(key: string): string | undefined {
  if (!rootEnv) {
    rootEnv = {}
    try {
      const text = readFileSync(resolve(process.cwd(), '../../.env'), 'utf8')
      for (const line of text.split('\n')) {
        const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line)
        if (!match || !WANTED.has(match[1]!)) continue
        const value = match[2]!.replace(/^(['"])(.*)\1$/, '$2')
        if (value !== '') rootEnv[match[1]!] = value
      }
    } catch {
      // No root .env — fall through to the process environment and the defaults.
    }
  }
  return rootEnv[key]
}

/// The API is down, or not configured. Rendered as a banner rather than a crash: during a demo
/// "the backend isn't running" should say so, not show a stack trace.
export class ApiUnavailable extends Error {}

/// The API answered with an error. `message` is owner-facing (apps/api/src/http/errors.ts).
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

function config() {
  const port = fromRootEnv('PORT') ?? '8787'
  const url = (process.env.ROSTER_API_URL ?? fromRootEnv('ROSTER_API_URL') ?? `http://localhost:${port}`).replace(/\/$/, '')
  const token = process.env.OWNER_API_TOKEN ?? fromRootEnv('OWNER_API_TOKEN')
  if (!token) throw new ApiUnavailable('OWNER_API_TOKEN is not set, so the dashboard cannot authenticate to the Roster API.')
  return { url, token }
}

export async function api<T>(path: string, init: { method?: 'GET' | 'POST'; body?: unknown } = {}): Promise<T> {
  const { url, token } = config()

  let response: Response
  try {
    response = await fetch(`${url}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        authorization: `Bearer ${token}`,
        ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: 'no-store',
    })
  } catch {
    throw new ApiUnavailable(`Could not reach the Roster API at ${url}. Is \`pnpm api:dev\` running?`)
  }

  const body = (await response.json().catch(() => ({}))) as { error?: { code?: string; message?: string } }
  if (!response.ok) {
    throw new ApiRequestError(
      response.status,
      body.error?.code ?? 'error',
      body.error?.message ?? `The Roster API returned ${response.status}.`,
    )
  }
  return body as T
}
