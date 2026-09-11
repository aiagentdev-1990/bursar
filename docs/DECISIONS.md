# Decisions

Settled questions, so they don't get relitigated. Newest first. Add the date and the reason.

## 2026-09-11 — Hiring: a new agent per hire, and the agent makes its own wallet
`POST /agents` now runs in this order: create a Managed Agents **Agent** for this hire with the
x402-arc skill attached (pinned to a version), start a session on it, let the skill's setup create
the wallet inside the agent's sandbox, hire the address it reports on-chain, then tell it the
Roster address, relay URL and caps.

- **One Agent per hire, not one per role.** Each carries its own name and role in its system
  prompt, and stays pinned to the skill version it was hired with, so a later upload cannot change
  how an agent already on the roster pays. Supersedes the cached per-role config.
- **The backend never generates or sees the agent's key.** It only learns the address, parsed
  strictly from the agent's `WALLET_ADDRESS:` line (a mixed-case address must carry a valid
  checksum, so a retyped typo fails instead of funding the wrong wallet).
- **Nothing is registered until the agent reports a wallet.** If setup fails, the hire fails with
  no on-chain state — better than an allowance attached to a wallet nobody holds.
- Without a Claude runtime (dev, the integration tests), the hire falls back to a local dev
  wallet and says so, so the on-chain half stays testable.
- The hire is synchronous and takes a minute or two while the agent sets up.

## 2026-09-11 — Agents hold no gas: `executeSpendFor`, a relayed spend
Gas on Arc is USDC — the same balance agents pay sellers with. An agent sending its own
`executeSpend` needs a float, and the float breaks three things:

- **It is spendable outside the cap.** The x402-arc skill's `pay.mjs` pays from the wallet
  directly. The demo's $0.02 float covers four $0.005 purchases the Roster never sees — a hole in
  "the contract is the only enforcement point", and in 2026-09-08's "agents hold nothing standing".
- **It never refills.** A release is exactly the payment amount and goes straight to the seller;
  held requests cost gas and release nothing. Top-ups would have to come from outside the caps.
- **Revocation doesn't reclaim it.**

Options considered: keep a bounded float (least work, but a hole a judge can name); an ERC-4337
paymaster via Circle Gas Station (no contract change, but smart accounts per agent, and Arc
testnet sponsorship is unverified); or a relayed call. Chose the relayed call.

`executeSpendFor(agent, amount, payee, memo, deadline, signature)`: the agent signs EIP-712
`Spend`, anyone submits, the relayer pays gas. It runs the *same* private `_spend` as
`executeSpend`, so there is one cap check, not two. Funds still go to the agent's wallet, never
to the caller, which is also why front-running a relayed spend is harmless. Replay is stopped by
a per-agent nonce (OpenZeppelin `Nonces`), cross-team replay by the domain (each clone's own
address — OpenZeppelin `EIP712` rebuilds the separator per clone), stale intents by `deadline`,
and revocation is checked before the signature so pre-signed intents die with the revoke.

`executeSpend` stays: it costs nothing to keep, and the seed script and existing callers use it.
Adding a function departs from "nothing not in §5" for the same reason as 2026-09-09's funds-out
amendment — it touches no cap, period or queue logic of its own. §5 is updated.

**The relay is `POST /relay/spend` in apps/api, unauthenticated.** The one route an agent calls,
and the one exception to §6's "owner-authenticated only" — the agent's signature is the
authorization and the contract verifies it; the route checks nothing itself. Every submission is
simulated first, so a bad signature, expired request or revoked agent is refused with the
contract's own error and costs no gas. It signs with a separate `RELAYER_PRIVATE_KEY`, never the
owner key, so nothing reachable from a public route can hire, approve or revoke. Chosen over a
Managed Agents custom tool because that would need the backend to hold a live event stream per
session; a URL works from any agent runtime. Consequence: the relay has to be publicly reachable
from the agent's sandbox — localhost is not.

Known gap: an agent can make the relayer pay gas for unlimited over-cap requests (held requests
consume no budget). Bounded by the relayer's small balance; rate-limit the route if it matters.

## 2026-09-11 — Deployed; the dashboard reads live state through apps/api
**Deployment (Arc testnet, block 61518811, source verified on ArcScan)** — redeployed the same day
to ship `executeSpendFor` (see the entry above):

| | Address |
|---|---|
| Roster — the demo owner's team (`ROSTER_CONTRACT_ADDRESS`) | `0x17a021A777A231509e6ddb13772CD32AB10ad258` |
| RosterFactory (`ROSTER_FACTORY_ADDRESS`) | `0x3e048665cab30e989A8de68E5F410fB3c0De2864` |
| Roster implementation | `0xaC733D08E1BF74f7589b0c6003cB57f6AaA6Aa1D` |
| Owner / deployer | `0x1BAB12dd29E89455752613055EC6036eD6c17ccf` |
| Relayer (`RELAYER_PRIVATE_KEY`) | `0x6BDF83FD0F7f1FfD167891F3914120DEb1935f2c` |

Retired: the first deployment (Roster `0x3BcC5Ff272F72c2a770D5E031699CFCe70287d80`, factory
`0xFfF59e42eEF09D6859b8Adc2b8D8679BF849b40D`, block 61507239). Drained to the owner with
`pnpm --filter @roster/api drain` before the redeploy; it holds nothing. Not upgradeable by
design, so a new function means a new Roster.

**ArcScan is Blockscout.** `/api/v2/addresses/{addr}/logs` answers in the shape `apps/api`
already decodes, `block_timestamp` included. That was checkpoint 9's first question; it is now
`BLOCKSCOUT_API_URL`'s default.

**The web app never reads the chain or Blockscout itself.** It calls `apps/api` from server
components, and approve/reject are server actions. Two reasons: the owner token stays on the Next
server instead of shipping to the browser, and there is exactly one implementation of the
events-to-roster derivation (membership, open requests, names from `Name|Role`) rather than a
second one in the browser that could drift from it. §4.5's split still holds — per-agent state
is `getAgent`, history is the event log.

**Demo figures are testnet-scale.** The mockup caps ($400, $900 …) would need ~$2,250 in the
treasury; the deployer holds ~$19. `apps/api/scripts/seed.ts` keeps the mockups' *shape* — five
agents, Runner holding an over-cap request while the others spend normally — with caps in cents
that the treasury can actually back. Consequence for the UI: `usdWhole` renders bare dollars only
for whole-dollar figures and falls back to cents otherwise, so a $1.50 cap is never shown as
"$2 cap" — the screen must not state a different limit than the contract enforces.

**Payee names ride in the memo as `Payee — note`.** The contract records a payee address and
nothing else, and the owner should not be reading addresses. The dashboard splits the memo on
` — ` and falls back to a shortened address when an agent didn't follow the convention.
Presentation only — the payee is still advisory (2026-09-09 below).

## 2026-09-09 — The payee is advisory, and the UI now says so
Found by auditing the contract. `executeSpend` and `approvePending` both transfer to the agent's
own wallet — never to the payee, which the agent then pays itself over x402 (§4.2, and the
2026-09-08 point-of-use decision). The payee recorded on a spend or a held request is the agent's
declaration of intent. The contract does not verify it and cannot enforce it: an agent can name
any payee and keep the funds.

That is inherent to the design and is not being changed — releasing at point of use is what makes
the kill switch meaningful. What was wrong was the pending screen, which read "Approving settles
$120.00 to Verity Watch Authentication immediately" and claimed a guarantee the contract does not
make. It now reads "Approving releases $120.00 to Runner to pay Verity Watch Authentication".

The cap is the guarantee; the destination is not. Worth having straight before a judge asks.

## 2026-09-09 — RosterFactory keeps no on-chain registry
Found by auditing the contract. `createRoster(owner)` indexed each deployment into
`_rostersOf[owner]`, but creation is permissionless by necessity: the backend deploys on an
owner's behalf during onboarding, so `msg.sender` is never the owner. That meant anyone could
attach unlimited rosters to any address — confirmed by pushing 50 onto a victim in a test — until
`rostersOf(victim)` was too large to read, and with attacker-created entries showing in any "your
teams" view.

Requiring `msg.sender == owner` would have fixed it and broken the actual flow. So the registry
is gone entirely: `_rostersOf`, `rostersOf`, `rosterCount` and `rosterAt` are removed, and
`RosterCreated` now carries `roster`, `owner` and `creator` as three indexed topics. A reader
filters by the creator it trusts.

Note this does not make the *pollution* impossible — anyone can still emit the event by calling
`createRoster` for someone else. It makes it unattributable-to-you rather than
stored-against-you: nothing grows in the contract, no read can be made to fail, and the creator
topic is enough to filter. Nothing depended on the index; the backend already learns its Roster
address from the deployment receipt and holds it in `ROSTER_CONTRACT_ADDRESS`.

## 2026-09-09 — `getAgent` reports the period the contract would enforce
Found by auditing the contract. `getAgent` returned raw storage, and `periodSpend` is only
zeroed inside `executeSpend`/`approvePending`. So between a period boundary and the agent's next
spend, the view still reported the previous period's total — measured on the fixture: it read
400/400 spent while the contract would happily execute a spend.

That is the number the dashboard's budget bar is drawn from, and the number the pending screen's
"monthly cap after" is computed from, and `apps/api` passes it through verbatim. Past day 30 of
any agent's life the UI would show an exhausted budget for an agent that can spend.

`getAgent` now applies the reset to its return value. The arithmetic lives in one private helper
used by both the storage write and the view, so there is no second implementation of period
math to drift — which is the same reason the dashboard reads `getAgent` at all instead of
recomputing spend from events.

## 2026-09-11 — No ERC-8004 integration
Evaluated in detail, including a working prototype on a fork of Arc testnet, and dropped. It adds
nothing functional to Roster:

- Enforcement — caps, period, revocation, approvals — runs on the Allowance Contract, keyed by
  wallet address, and has to. Reading enforcement state from an external, upgradeable registry would
  put a second failure mode inside the single point of enforcement (R4), and the kill switch must
  never depend on one.
- So the only field the registry could have taken over was `role`, which is display-only and which
  the backend can hold just as well.
- Its one real benefit — letting a counterparty check which roster an agent belongs to — needs
  counterparties that look. None of the demo's do.
- `setAgentWallet` required the agent's wallet to sign an EIP-712 message during hiring, which drove
  most of the complexity in the onboarding design.

Consequences: `onlyAgent` binds to a plain address (settles open question 2); `role` stays in
`AgentInfo` along with the `Name|Role` convention; §4.1 no longer mints identities.

If this is ever revisited, the verified facts: the IdentityRegistry is at
`0x8004A818BFB912233c491871b3d84c89A494BD9e` on Arc testnet; `register` uses `_safeMint`, so a
contract holding an identity must implement `onERC721Received`; `register` returns the `agentId`
and emits `Registered`; `setAgentWallet` needs an EIP-712 `AgentWalletSet` signature from the wallet.

## 2026-09-09 — §5 amendment: funds must be able to leave the Roster
Found by auditing the contract. `fundAgent` had no counterpart, and the Roster had no exit at
all, so two things were permanently locked:

- USDC delivered to the Roster but never earmarked. §4.6's whole funding rail delivers to this
  address, so any over-delivery was stuck. Measured on the test fixture: 8,000 of 10,000 USDC
  unreachable.
- A revoked agent's remaining earmark. Revoking an agent left its budget assigned to a dead
  agent, still counted in `totalEarmarked`, usable by nobody. That made the kill switch — the
  action the whole product is built around — cost the owner real money to pull.

`defundAgent(agent, amount)` and `withdrawTreasury(to, amount)` are added to §5. Both are
`onlyOwner`. The invariant they preserve is `USDC.balanceOf(roster) >= totalEarmarked`: an
agent always keeps what it was promised, and only the surplus can leave. `withdrawTreasury`
is bounded by `balance - totalEarmarked` and reverts otherwise, so it cannot take an earmark
out from under a working agent.

This is a deliberate departure from CLAUDE.md's "do not add any function not in §5" — the rule
exists to keep the enforcement surface small, and neither function touches a cap, a period, or
the pending queue. §5 has been updated so the two documents agree.

## 2026-09-09 — Contract shape: fixed period, no sweep, one Roster per team
Three changes settled while building checkpoint 1. Each closes an open item above.

**`periodLength` is gone; the period is a fixed `PERIOD_LENGTH = 30 days`.** It was carried on
`AgentInfo` but `hireAgent` never took one and §5 had no setter, so it had no source. Making it a
constant rather than a parameter is what the 2026-09-09 monthly decision already implied: the
dashboard says "Monthly cap" and "September cap" everywhere, and a per-agent period would let the
UI name a boundary the contract wasn't enforcing. `periodStart` advances by whole periods, so an
agent that goes quiet for three months does not get a fresh period starting the moment it wakes up.

**`sweepUnspent` is removed, not deferred-in-place.** It could not work as specified: pulling USDC
back from an agent's wallet needs an ERC-20 allowance that §4.1's onboarding never established.
Rather than ship a function that reverts, it is out of the interface entirely. The exposure it was
meant to cover is already bounded by the 2026-09-08 point-of-use release below — at most one
request's worth is ever stranded. Reintroduce it only alongside the approve step in onboarding that
it actually requires. `FundsSwept` and `POST /agents/{id}/sweep` are gone with it.

**`fundAgent` earmarks USDC the Roster already holds; it does not pull from the owner.** No
`transferFrom`, no owner approval step. This matches §4.6, where Bridge Kit delivers to the Roster
address and funding is the allocation that follows. The contract tracks `totalEarmarked` and
refuses any `fundAgent` that would earmark more than the balance covers — otherwise the same USDC
could be promised to two agents and the second would fail at transfer time rather than at the
moment the owner made the mistake.

**One Roster per agent team, deployed by `RosterFactory` as EIP-1167 minimal proxies.** A team is
the natural tenancy boundary: one owner, one treasury, one set of agents. Clones make a new team a
45-byte deployment over a shared implementation. Deliberately **not** upgradeable — R4 is that the
contract is the single point of enforcement and therefore the single point of failure, and an
upgrade path would add a second way for the guarantee to fail, one an owner could not audit by
reading the code their agents are bound to. Isolation now holds at two levels: between agents on a
Roster (storage layout, §4.4) and between teams (separate contracts, separate treasuries).

## 2026-09-09 — The five mockup/PRD discrepancies, settled for checkpoint 8
Resolved in the order they appear in `docs/mockups/README.md`. The mockups win on anything that is
purely presentational; the PRD wins on anything the demo has to perform live.

1. **Agent count — five on the roster, three driven live.** The mockups' five-row table is what
   makes the screen read as a *roster* rather than a list, and the overview's derived figures
   (`$2,250 committed`, `UNSPENT $724`) only balance across five agents. PRD §7's demo narrative
   still drives three (Pricer, Concierge, Runner); Scout and Ledger sit on the roster as settled,
   already-active agents and are never touched on stage. This keeps risk R5 (three agents in one
   live take) from getting worse while keeping the screen the mockups drew.
2. **Agent names — mockup names.** Pricer, Concierge, Runner, Scout, Ledger. `docs/mockups/README.md`
   already recommended this. PRD §7's functional descriptions become the role text under each name:
   Pricer ≈ pricing, Concierge ≈ support, Runner ≈ fulfillment.
3. **Period wording — monthly, and the contract must enforce a month.** The UI keeps "Monthly cap"
   and "September cap" because the mockups' whole frame (`ROSTER SPEND · SEPTEMBER 2026`) is built
   on a calendar month. This means `periodLength` is fixed at 30 days for the demo. The UI must not
   imply a boundary the contract isn't enforcing, so this is a constraint on checkpoint 1, not just
   a copy choice: PRD §7's weekly caps ($100/wk, $50/wk, $400/wk) are superseded.
4. **Demo numbers — mockup figures.** Pricer $400 monthly, Concierge $150, Runner $75 per-transaction
   / $900 monthly. The $120-over-a-$75-limit beat is identical in both documents and is unaffected.
   Scout ($500) and Ledger ($300) are new and chosen so the mockups' derived totals balance exactly.
5. **Category vs role — category is derived, the contract stays single-field.** The contract keeps
   one `role` string and learns nothing new. The hire form is four fields with no category input
   (that is §4.1's "owner never sees an address" constraint showing up as form simplicity), so
   category *cannot* be collected — it is derived from the role text in the UI by keyword. See
   `apps/web/lib/categories.ts`. Note this is agent-level category; the category shown against an
   individual payment in the activity log is a property of that payment, not of the agent.

## 2026-09-09 — Money crosses the UI as base units, formatted only at render
Every amount in `apps/web` is a `bigint` in USDC base units (6dp), matching the contract. There is
no `number` money type anywhere in the app. `lib/money.ts` is the only place a base-unit value
becomes a string, and the only place a typed string becomes base units. This is CLAUDE.md's
"never use floats for money" rule made structural rather than aspirational.

## 2026-09-08 — x402 only, no MPP
MPP's confirmed settlement path is Tempo, not Arc, and no Arc-specific facilitator is confirmed
to exist. Circle publishes a working Arc-testnet x402 facilitator. Building against MPP inside an
eight-day window would mean depending on something unverified. Revisit only if an Arc-specific
settlement path is confirmed.

## 2026-09-08 — The contract holds the treasury; agents hold nothing standing
`executeSpend` releases USDC to the agent's own wallet only at point of use, immediately before
the x402 retry. This bounds the released-but-unspent exposure to a single request instead of an
accumulating balance, which is what makes the kill switch meaningful. *(Amended 2026-09-09: the
`sweepUnspent` half of this is removed — see above. The point-of-use release stands, and is now the
only thing bounding the exposure.)*

## 2026-09-08 — Dashboard reads Blockscout, not the contract
No indexer to build or maintain. Roster overview and the pending screen are both views over the
same `/api/v2/addresses/{contract}/logs` event stream.

## Open — see CLAUDE.md
- Circle Agent Stack testnet SDK on Arc: real, or hand-roll x402?
- Keep "payroll" (recurring top-up) or cut it?
- The contract has no `name` field, but the hire form collects Name *and* Role as separate inputs.
  Either the backend stores the name off-chain keyed by agent address, or the `role` string carries
  both. Blocks checkpoint 6; does not block the UI, which treats name as backend-owned.

*(`periodLength` and `sweepUnspent`: both settled 2026-09-09 — see the contract-shape entry above.)*

*(Three demo agents or two: settled 2026-09-09 — five on the roster, three driven live.)*

*(Agent identity: settled 2026-09-11 — a plain address, no ERC-8004.)*
