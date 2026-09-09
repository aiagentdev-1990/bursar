# Roster — working notes for Claude Code

Read `docs/PRD.md` and `docs/TECH-DESIGN.md` before writing code. They are the spec.
`docs/BACKLOG.md` is the build order. `docs/DECISIONS.md` is where settled questions go.
Before any UI work, read `docs/mockups/README.md` — it transcribes the four reference screens and
lists five unresolved conflicts between them and the PRD.

## What this is

A financial control layer for AI agents. An owner "hires" agents onto a roster; each gets a
per-transaction cap and a per-period cap enforced **on-chain**. In-cap spend executes with no
owner signature. Over-cap spend holds pending until the owner approves or rejects. Any single
agent can be revoked instantly with zero effect on the others.

Built for ETHGlobal 2026 (Sept 4–16). Judged on a live demo, not on production readiness.

## Non-negotiables

- **The contract is the only enforcement point.** Never add a cap check in the backend or the UI
  as the thing that enforces a limit. Application-level checks are UX hints at most; the guarantee
  lives in Solidity. Risk R4 in the PRD: if the contract is wrong, the pitch is wrong.
- **Arc testnet only** (chain id `5042002`). USDC is the native gas asset, ERC-20 predeploy
  `0x3600000000000000000000000000000000000000`.
- **x402 only. Do not add MPP.** No confirmed Arc settlement path exists for it. This was decided;
  see PRD §9.
- **The owner never sees a wallet address or an agent ID.** Privy provisions wallets; the UI shows
  names and roles.
- **`revokeAgent` touches one agent's struct and nothing else.** Isolation is a storage-layout
  property, not application logic. Any change that loops over agents is a bug.
- **No oracles, no price feeds, no lending, no credit.** Roster never prices an asset.

## Layout

```
packages/contracts/   Foundry. The Allowance Contract — the whole guarantee lives here.
apps/api/             Node + TypeScript. Owner-authenticated backend (tech design §6).
                      Talks to Privy, the contract, Claude Managed Agents, Bridge Kit.
apps/web/             Next.js dashboard. Roster overview, hire form, pending approval, activity.
docs/                 PRD, tech design, backlog, decisions.
docs/mockups/         Four UI reference screens (JPG) + README.md transcribing them.
```

The contract ABI is the interface between all three. When a contract signature changes, update
the backend and the UI in the same change — do not let them drift.

## Conventions

- Solidity 0.8.26, Foundry. Custom errors, not revert strings. Named events per tech design §4.
- USDC is 6 decimals. Caps and amounts are always `uint256` in base units. Never use floats for
  money anywhere in the stack — parse and format at the UI edge only.
- Backend and web are TypeScript, strict mode. `viem` for chain reads/writes, not ethers.
- Secrets live in `.env` (gitignored). `.env.example` lists every key the system needs.
- Reads for the dashboard go through **Blockscout**, not through direct contract calls
  (tech design §4.5). There is no indexer to build.

## Testing bar

Cap math and the lazy period-reset in `executeSpend` are the two places a bug breaks the product's
central claim. They get unit tests before anything else is built on top:

- spend exactly at `perTxCap` passes; one base unit over goes pending
- cumulative spend crossing `perPeriodCap` mid-period goes pending
- a spend after the period boundary passes with a zeroed counter, without any maintenance call
- a revoked agent's `executeSpend` reverts, and a second agent's spend in the same block succeeds

## Things that are genuinely unresolved

Do not invent an answer to these — flag them and ask.

1. Whether Circle's Agent Stack has a testnet-ready SDK on Arc, or whether §4.2's facilitator
   interaction has to be hand-rolled against the raw x402 spec.
2. Whether `onlyAgent` binds to a plain address or has to resolve through ERC-8004.

Checkpoint 2 in `docs/BACKLOG.md` (verify the facilitator by hand against one real service) blocks
most of the rest. Front-load it.

## Working style

- Concrete names over abstractions. `executeSpend`, `PendingRequest`, `sweepUnspent` — the tech
  design already names things; use those names.
- Small commits per checkpoint. Update `docs/BACKLOG.md` when a checkpoint lands.
- When a design question gets settled during a session, write it into `docs/DECISIONS.md` with the
  date and the reason, so it doesn't get relitigated tomorrow.
