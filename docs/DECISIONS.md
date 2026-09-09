# Decisions

Settled questions, so they don't get relitigated. Newest first. Add the date and the reason.

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
accumulating balance, which is what makes the kill switch meaningful. `sweepUnspent` reclaims
anything stranded by a failed payment or a revocation.

## 2026-09-08 — Dashboard reads Blockscout, not the contract
No indexer to build or maintain. Roster overview and the pending screen are both views over the
same `/api/v2/addresses/{contract}/logs` event stream.

## Open — see CLAUDE.md
- Circle Agent Stack testnet SDK on Arc: real, or hand-roll x402?
- Agent identity: plain address or ERC-8004?
- Keep "payroll" (recurring top-up) or cut it?
- `periodLength` has no source: `AgentInfo` carries it, `hireAgent` doesn't take it and no setter
  exists in §5. The 2026-09-09 decision above fixes it at 30 days, but the signature still has to
  say so — constructor constant or a fifth `hireAgent` parameter.
- `sweepUnspent` needs an ERC-20 allowance from the agent's wallet to the contract, which nothing
  in §4.1's onboarding sequence establishes. Blocks checkpoint 3.
- The contract has no `name` field, but the hire form collects Name *and* Role as separate inputs.
  Either the backend stores the name off-chain keyed by agent address, or the `role` string carries
  both. Blocks checkpoint 6; does not block the UI, which treats name as backend-owned.

*(Three demo agents or two: settled 2026-09-09 — five on the roster, three driven live.)*
