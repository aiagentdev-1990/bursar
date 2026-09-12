# ETHGlobal submission copy

## Description

Bursar is where you manage a team of AI agents and the money they spend.

AI agents increasingly pay their own way in stablecoins — search queries, model calls, data pulls,
even hiring a person for a one-off job. Around 160 million payments have settled over the x402
payment protocol so far, now running at roughly 16 million a month, and nearly all of it is USDC.

One agent is easy to keep an eye on. A team of them isn't — once you're running five, there is no
single answer to what the team is allowed to spend, what it has already spent, or how to stop one
agent without disturbing the rest. Each agent is a separate wallet you keep funded by hand, their
spending is spread across wallets and vendor invoices, and the limits you set live in a dashboard
that can't actually stop a payment. So you either approve every payment yourself, which defeats the
point of hiring them, or you find out what happened when the bill arrives.

Bursar puts the whole team on one shared balance and gives each agent two limits: how much it can
spend on a single purchase, and how much it can spend in a month. Inside those limits it just pays —
no approval, no interruption, and you never handle a wallet or a key. Go over either limit and the
payment doesn't go through; it waits on your screen until you approve or reject it. And you can cut
off any one agent instantly, while the rest carry on working.

What makes it hold is where the limits live. They aren't settings in our app — they're in the smart
contract that holds the money, so they're checked at the moment a payment is made rather than
reported after it.

Deployed and source-verified on Arc testnet at `0x823C07bd183405E6FDf3e2e0412315D3B6fDfBBa`.

## How it works

At the centre is the Roster contract — one per team, deployed from a RosterFactory. It is the
team's account and its rulebook in one: it holds the team's USDC and, for each agent, two limits
(per purchase and per month), what that agent has spent this period, and whether it is still
employed. Every payment goes through it, and nothing else checks a limit — an agent can always talk
to the chain directly, so the only check worth having is the one between the money and the door.

Hiring is a name, a role and two limits in the UI. Bursar provisions a Claude managed agent carrying
a version-pinned skill for paying through the Roster; on startup that agent generates its own
keypair inside its own sandbox and reports back nothing but an address, which Bursar registers with
those limits. We never see the agent's key, and the owner never sees an address.

From then on it spends on its own. It calls a paid service, gets a 402, and signs an intent — it
holds no gas, because gas on Arc is USDC and a float would be spendable outside its limits — which a
relayer submits and pays for. The contract verifies the signature, rolls the monthly counter if the
period has turned, and checks both limits. Inside them it releases the USDC to the agent's wallet
and the agent pays the service; the owner is never asked. The contract never pays the service
itself, so the payee on a request is the agent's stated intent rather than a guarantee.

Every payment lands as an event on the Roster, so the dashboard reads live limits and month-to-date
spend from the contract and history from the chain's explorer API. There is no indexer.

Over either limit, nothing moves: the payment is held for the owner, who approves or rejects it.
Approving overrides the per-purchase limit but still counts against the month, and firing an agent
beats a request already waiting. Firing writes one field on one agent's record, in a function with
no loop over agents, so one agent can be cut off mid-loop while the others keep spending in the same
block.

## How it's made

**The contract is the only enforcement point.** `Roster.sol` (Solidity 0.8.26, Foundry) holds the
team's USDC and every agent's `perTxCap`, `perPeriodCap`, `periodSpend` and `periodStart` in one
struct. `executeSpend` checks both caps and transfers, or queues a `PendingRequest` for the owner —
one code path, custom errors, no revert strings. The monthly period resets lazily inside the spend
call, computed from `periodStart` rather than swept by a cron, and the same private helper backs
`getAgent` so the dashboard can never show a budget the contract wouldn't honour. `revokeAgent`
writes one agent's struct and cannot loop, which is what makes per-agent isolation a storage-layout
property instead of application logic. Teams are EIP-1167 minimal-proxy clones from `RosterFactory`,
deliberately non-upgradeable — the single point of enforcement shouldn't have a second way to fail.
132 Foundry tests across 12 suites, one per contract function.

**Agents hold no gas, because on Arc gas *is* USDC.** An agent paying its own gas needs a float, and
that float is spendable outside the caps — a hole straight through the central claim. So spends are
relayed: the agent signs an EIP-712 `Spend` intent (OpenZeppelin `EIP712` + `Nonces`, with a
deadline, and revocation checked before the signature so pre-signed intents die with the revoke) and
`POST /relay/spend` submits it, paying gas from a relayer key that can't hire, approve or revoke.
`executeSpendFor` runs the *same* private `_spend` as `executeSpend`, so there is one cap check in
the codebase, not two. Every submission is simulated first, so a bad signature or a revoked agent is
refused with the contract's own error and costs no gas.

**Real x402 payments, self-facilitated.** No public x402 facilitator supports Arc, so `apps/seller`
runs `@x402/core`'s facilitator in-process alongside `@x402/express` and the `exact` EVM scheme —
it answers 402, verifies and settles its own payments in real USDC on Arc, and exposes a free
`/catalog` an agent can read to decide what to buy. Agents are Claude Managed Agents: one Agent per
hire, carrying a version-pinned `x402-arc` skill, so a later skill upload can't change how an agent
already on the team pays. The agent generates its own key inside its sandbox and reports only the
address, parsed with a strict checksum check — the backend never sees a private key.

**Backend and dashboard.** `apps/api` is Node + TypeScript on viem, owner-authenticated, and it
never holds funds or signs for an agent. Hiring runs as a resumable background job that records each
step to disk, so a redeploy mid-hire resumes instead of stranding an allowance on a wallet nobody
holds; all owner writes go through a single queue because two hires landing together would otherwise
collide on the owner's nonce. `/relay/spend` is the one unauthenticated route, and the only one —
the agent's signature is the authorization and the contract verifies it. The Next.js dashboard reads
per-agent state from `getAgent` and history from ArcScan's Blockscout `/api/v2` logs, so there is no
indexer to build; every amount crossing the app is a `bigint` in USDC base units, formatted only at
render, so no float ever touches money. The API's integration tests boot a throwaway anvil node per
file and deploy the real compiled bytecode — real EVM, real event decoding, no mocked chain.

**Deliberately not used:** no oracles or price feeds (Bursar never prices an asset), no MPP (its
confirmed settlement path is Tempo, not Arc), and no ERC-8004 — we prototyped it on an Arc fork and
dropped it, because reading enforcement state from an external upgradeable registry would put a
second failure mode inside the one contract the kill switch depends on.

## How we're using Arc

Bursar runs entirely on Arc testnet (chain `5042002`). The Roster contract and its factory are
deployed and source-verified there, USDC is the only asset in the system, and every payment in the
demo settles on Arc in real USDC.

Arc's design changed ours in one concrete way. Because USDC is the native gas asset, an agent paying
its own gas would be holding spendable money outside its limits — a hole straight through the
guarantee — so spends are relayed instead: the agent signs an intent, a relayer submits it, and
agents hold nothing at all. Arc's sub-cent fees and sub-second finality are also what make an
on-chain check per purchase reasonable in the first place; on a chain with dollar-scale fees,
enforcing a limit on a thirteen-cent payment would cost more than the payment.

Two smaller things: ArcScan is Blockscout, so the dashboard's activity feed reads its `/api/v2` logs
directly and there is no indexer to run, and since no public x402 facilitator supports Arc yet, our
demo seller runs the facilitator in-process and settles its own payments.

## How AI tools were used

- **Claude Code wrote most of the repo** — contracts, backend and dashboard — against a docs-first
  spec (PRD, tech design, backlog) and a `CLAUDE.md` of standing rules: the contract is the only
  enforcement point, never a float for money, `revokeAgent` touches one agent.
- **Claude audited its own contract**, which is where three real bugs came from: an unbounded
  factory registry anyone could pollute, `getAgent` reporting a stale period after a boundary, and
  UI copy claiming a settlement guarantee the contract doesn't make. All recorded in
  `docs/DECISIONS.md`.
- **The agents in the product are Claude Managed Agents** — each hire provisions a real agent in its
  own sandbox. The demo's spending is agents actually working, not a simulation.
- **An Agent Skill is how they pay:** `skills/x402-arc` packages wallet setup, 402 handling and
  signing, and each agent is pinned to a skill version when hired.
- **Demo deck, script and submission copy** drafted with Claude.
