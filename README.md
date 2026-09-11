# Roster

Give every AI agent on your small team a budget and a role, the way you'd onboard an employee —
enforced by a contract, not a policy.

Built for ETHGlobal 2026 on Arc testnet (chain id 5042002).

## Getting started

Foundry deps are git submodules, so clone with `--recursive` (or run `git submodule update
--init --recursive` in an existing clone).

```bash
cp .env.example .env      # fill in the keys you have; leave the rest blank
pnpm install
pnpm test
```

`.env.example` lists every credential the system needs, grouped by whether it is required now,
needed for a specific checkpoint, or not on the critical path yet.

## Running it

The contracts are deployed on Arc testnet — addresses in `docs/DECISIONS.md` (2026-09-11) and in
`.env` as `ROSTER_CONTRACT_ADDRESS` / `ROSTER_FACTORY_ADDRESS`.

```bash
pnpm api:dev                              # owner API on :8787 — contract reads + ArcScan history
pnpm web:dev                              # dashboard on :3000, reads through the API
pnpm --filter @roster/api seed            # fund the Roster, hire five agents, play a morning
pnpm --filter @roster/api seed activity   # one more in-cap spend per agent
```

The seed is idempotent against a given Roster: it hires nobody twice and plays the scripted
morning only once. To deploy a fresh Roster instead:

```bash
cd packages/contracts && forge script script/Deploy.s.sol:Deploy --rpc-url arc_testnet --broadcast
```

## Testing

```bash
pnpm test                 # everything: contract tests, then api unit + integration
pnpm contracts:test       # forge — one suite per contract function, 119 tests
pnpm api:test             # api — unit tests, then integration against a real chain
```

Contract tests are organised one file per function, `[Contract]_[Function]_Test.sol`, sharing a
fixture in `test/base/RosterTestBase.sol`. Tests that assert a revert follow Foundry's
`test_RevertWhen_[Scenario]` convention, so a suite's failure modes are greppable.

The API integration tests boot a throwaway **anvil** node per file, deploy the real compiled
contracts to it, and mount the app in-process. Real EVM, real bytecode, real RPC round trips,
real event decoding. Two things are stubbed and both are deliberate:

- **Blockscout** — no explorer exists for a local node, so a stub re-serves the node's own logs
  in Blockscout's response shape. Everything on our side of that boundary is still exercised.
  Checkpoint 9 confirms the shape against the live instance.
- **Claude Managed Agents** — checkpoint 4. Its *absence* is under test: a hire whose session
  cannot start must still register on-chain with its caps enforced.

They need Foundry on `PATH`. Without it they skip with a message rather than failing.

## Docs

- `docs/PRD.md` — what this is, who it's for, what's out of scope
- `docs/TECH-DESIGN.md` — mechanisms, contract functions, backend endpoints
- `docs/BACKLOG.md` — build order, with a kickoff prompt per checkpoint
- `docs/DECISIONS.md` — settled questions

## Layout

| Path | What |
|---|---|
| `packages/contracts` | Foundry — the Allowance Contract, the only enforcement point |
| `apps/api` | Owner-authenticated backend (Privy, contract, Claude Managed Agents, Bridge Kit) |
| `apps/web` | Next.js roster dashboard |
