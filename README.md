# Roster

Give every AI agent on your small team a budget and a role, the way you'd onboard an employee —
enforced by a contract, not a policy.

Built for ETHGlobal 2026 on Arc testnet (chain id 5042002).

## Getting started

```bash
cp .env.example .env      # fill in the keys you have; leave the rest blank
pnpm install
cd packages/contracts && forge install foundry-rs/forge-std --no-commit
forge build
forge test -vv
```

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
