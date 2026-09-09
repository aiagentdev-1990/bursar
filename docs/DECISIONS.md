# Decisions

Settled questions, so they don't get relitigated. Newest first. Add the date and the reason.

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
- Agent identity: plain address or ERC-8004?
- Keep "payroll" (recurring top-up) or cut it?
- The contract has no `name` field, but the hire form collects Name *and* Role as separate inputs.
  Either the backend stores the name off-chain keyed by agent address, or the `role` string carries
  both. Blocks checkpoint 6; does not block the UI, which treats name as backend-owned.

*(`periodLength` and `sweepUnspent`: both settled 2026-09-09 — see the contract-shape entry above.)*

*(Three demo agents or two: settled 2026-09-09 — five on the roster, three driven live.)*
