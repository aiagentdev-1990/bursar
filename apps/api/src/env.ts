import { config } from 'dotenv'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

/// The one `.env` lives at the repo root (README, "Getting started"), but pnpm runs this package
/// with apps/api as its cwd, so dotenv's default lookup never finds it. Load the root file
/// explicitly. Neither call overrides a variable already set, so a real environment still wins.
///
/// Skipped under NODE_ENV=test: the integration harness sets its own environment and deletes
/// ANTHROPIC_API_KEY on purpose, and the root file would quietly put real credentials back.
if (process.env.NODE_ENV !== 'test') {
  config()
  config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env') })
}

/// Fail at boot with a readable list, not at the first request with a cryptic undefined.

const address = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, 'must be a 0x-prefixed 20-byte address')
  .transform((v) => v as `0x${string}`)

/// Accepts a key with or without the 0x prefix — wallets export both, and forge and viem each
/// insist on their own. Normalised here so nothing downstream has to care.
const hex32 = z
  .string()
  .regex(/^(0x)?[0-9a-fA-F]{64}$/, 'must be a 32-byte hex private key')
  .transform((v) => (v.startsWith('0x') ? v : `0x${v}`) as `0x${string}`)

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(8787),

  // ── chain ──
  ARC_TESTNET_RPC_URL: z.string().url(),
  ARC_CHAIN_ID: z.coerce.number().int().default(5042002),
  USDC_ADDRESS: address.default('0x3600000000000000000000000000000000000000'),
  /// Optional on purpose. Without it the service runs in **provisioning-only** mode: it creates
  /// wallets and Claude sessions but registers nothing on-chain, and no cap is enforced anywhere.
  /// Scaffolding for building the onboarding flow ahead of the contract, not a supported mode.
  ROSTER_CONTRACT_ADDRESS: address.optional(),
  ROSTER_FACTORY_ADDRESS: address.optional(),

  /// The owner's signing key. hireAgent, approvePending, rejectPending, revokeAgent and
  /// updateCaps are all `onlyOwner`, so the backend must be able to sign as the owner. It never
  /// signs on an *agent's* behalf — agents hold their own keys via Privy (§6).
  OWNER_PRIVATE_KEY: hex32,

  // ── reads (§4.5) ──
  /// ArcScan is a Blockscout deployment and serves /api/v2/addresses/{addr}/logs, block
  /// timestamps included — confirmed against the live instance 2026-09-11.
  BLOCKSCOUT_API_URL: z.string().url().default('https://testnet.arcscan.app'),
  BLOCKSCOUT_API_KEY: z.string().optional(),

  // ── auth ──
  /// Bearer token for every endpoint. Placeholder until Privy auth lands (checkpoint 3), at
  /// which point this becomes a Privy access-token verification.
  OWNER_API_TOKEN: z.string().min(16, 'use at least 16 characters'),

  // ── agent wallets (§4.1, checkpoint 3) ──
  WALLET_PROVIDER: z.enum(['privy', 'local']).default('local'),
  PRIVY_APP_ID: z.string().optional(),
  PRIVY_APP_SECRET: z.string().optional(),

  // ── Claude Managed Agents (§4.1, checkpoint 4) ──
  ANTHROPIC_API_KEY: z.string().optional(),
  CLAUDE_ENVIRONMENT_ID: z.string().optional(),

  /// The roster-payments skill, attached to every role's Agent config.
  /// Note the two id shapes: `skill_…` identifies the skill, `skver_…` a specific version of it.
  /// Passing a version id as the skill id is rejected with "skill_id not found".
  CLAUDE_PAYMENT_SKILL_ID: z.string().default('skill_01KbK1RJhZ1gGXL5NeijmU6L'),
  /// Pinned so a re-upload cannot change agent behaviour underneath a running demo.
  /// Set to "latest" to track edits instead.
  CLAUDE_PAYMENT_SKILL_VERSION: z.string().default('skver_01TrRWRjpkUr8JgoGkFc59nS'),

  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  /// Where services/store.ts keeps operational state. Tests point this at a temp file.
  ROSTER_STORE_FILE: z.string().optional(),
})

export type Env = z.infer<typeof schema>

let cached: Env | undefined

export function loadEnv(): Env {
  if (cached) return cached

  // `.env.example` says "leave the rest blank", and a blank `KEY=` arrives as "" — which would
  // fail `.url()` and skip every `.default()`. Blank means unset.
  const set = Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== ''))
  const parsed = schema.safeParse(set)
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`)
    throw new Error(`Invalid environment — see .env.example\n${lines.join('\n')}`)
  }

  if (parsed.data.WALLET_PROVIDER === 'local' && parsed.data.NODE_ENV === 'production') {
    throw new Error('WALLET_PROVIDER=local generates agent keys in-process; never use it in production.')
  }

  cached = parsed.data
  return cached
}
