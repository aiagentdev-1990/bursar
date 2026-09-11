# Build order

Hackathon runs Sept 4–16. Checkpoints map to tech design §7. Each one has a kickoff prompt you can
paste into Claude Code as-is. Mark `[x]` as they land.

Order matters in one place: **checkpoint 2 blocks 5, 6 and everything downstream.** Do it first or
second, not later — everything from the payment tool onward assumes the facilitator behaves the way
Circle's walkthrough describes, and that hasn't been tested by hand.

---

## Day 1 — the guarantee

- [x] **1. Allowance Contract on Arc testnet** — written and tested 2026-09-09; **deployed and
      verified on ArcScan 2026-09-11** (addresses in DECISIONS.md). `Roster.sol` + `RosterFactory.sol`,
      all four testing-bar cases covered. `sweepUnspent` dropped and the period fixed at 30 days;
      see DECISIONS.md 2026-09-09.
  > Read docs/TECH-DESIGN.md §4.2–4.4 and §5. Implement `packages/contracts/src/Roster.sol`
  > against `IRoster.sol` — every function in §5, custom errors, the events in §4. Period reset is
  > lazy (computed inside `executeSpend`, no maintenance call). Write `test/Roster.t.sol` first,
  > covering the four cases in CLAUDE.md's testing bar. Then a `script/Deploy.s.sol` for Arc
  > testnet. Do not add any function not in §5.

- [ ] **2. Verify Circle's Arc-testnet x402 facilitator by hand** ← front-load this
  > Before any product code depends on it: make one real x402 payment on Arc testnet against one
  > live service (Brave Search is the simplest). A throwaway script in `packages/contracts/script/`
  > or a scratch TS file is fine. Answer concretely: does Circle's Agent Stack expose a
  > testnet-ready SDK on Arc, or does this have to be hand-rolled against the raw x402 spec?
  > Write the answer into docs/DECISIONS.md. If it's hand-rolled, capture the exact 402 response
  > shape and the signed-header format you got working.

## Day 2 — wallets and identity

- [ ] **3. Privy wallet provisioning**
  > Wire Privy embedded-wallet creation for the owner and for agents. Prove an agent's Privy wallet
  > can (a) submit `executeSpend` to the deployed contract and (b) sign a real x402 payment header,
  > with no manual key handling anywhere in the path. This is the Privy "Best Financial Flow" track
  > evidence — one authorization covering ongoing activity.

- [ ] **4. Claude Managed Agents resources**
  > One Agent config per demo role (pricing, support, fulfillment), one Environment, per
  > TECH-DESIGN.md §4.1. Beta header `managed-agents-2026-04-01`. Confirm a Session provisions and
  > that a user event actually starts it working — session creation alone does not.

## Day 3–4 — the agent's hands, and the backend

- [ ] **5. The agent's x402 payment tool**
  > The one component that has to work inside a Claude Managed Agents session, not just in
  > isolation. Reads a 402 response, calls `executeSpend`, and on success signs and retries the
  > x402 request. The failure branch — released but not spent — currently strands the USDC in the
  > agent's wallet; there is no sweep. Log it clearly rather than pretending it reconciles.

- [x] **6. Backend endpoints** — landed 2026-09-09. All of §6 in `apps/api`, covered by 26
      integration tests against a real chain (`pnpm api:test`). Privy (3) and Managed Agents (4)
      sit behind interfaces and fail loudly when unconfigured rather than silently.
  > All of TECH-DESIGN.md §6 in `apps/api`. Owner-authenticated only — agents never call these.
  > The backend never holds funds and never signs on an agent's behalf; it only orchestrates.

- [x] **7. `PaymentPending` listener + two-step approve** — landed 2026-09-09 alongside 6, with
      its own integration suite. Approval waits for the receipt before the session event; it is
      never inferred from `SpendExecuted`.
  > A persistent contract event listener (not an endpoint). On owner approval: call
  > `approvePending`, confirm it succeeded, *then* send the Claude session-resume event. Do not
  > infer approvals from the `SpendExecuted` stream — §4.2's ordinary path fires it too.

## Day 5 — the surface

- [x] **8. UI, mocked data** — landed 2026-09-09. `apps/web`, Next.js App Router, four screens.
      All five discrepancies settled first; see DECISIONS.md 2026-09-09.
  > Hire-agent form, roster overview, pending-approval detail and activity log in `apps/web`.
  > The four mockups are in `docs/mockups/` — open the JPGs, and read `docs/mockups/README.md` for
  > the transcribed copy, the design system, and five known discrepancies with the PRD (agent count,
  > agent names, monthly-vs-period wording, demo cap figures, category-vs-role). Settle those five
  > before writing components. Static data first — the layout is the deliverable at this checkpoint.

- [x] **9. Wire overview + activity feed to Blockscout** — landed 2026-09-11. `apps/web` reads
      through `apps/api` on the Next server: caps and spend from the contract's `getAgent`, history
      from ArcScan's Blockscout API (confirmed to serve the v2 logs shape). Fixtures deleted. Pending
      approve/reject wired as server actions; the hire form is still inert. Demo data comes from
      `pnpm --filter @roster/api seed`. See DECISIONS.md 2026-09-11.
  > Replace the mocks. `GET /api/v2/addresses/{contract}/logs`, grouped by agent, budget bars
  > computed client-side, pending items flagged.

## Day 6 — nice-to-haves, in cut order

- [ ] **10. Bridge Kit / Unified Balance funding + payroll schedule** — cut if open question 4 says the demo doesn't need it
- [ ] **12. Bazantic recipe** — cheapest addition, safest to leave last, $1,000 track

## Day 7–8 — the thing that's actually judged

- [ ] **11. End-to-end rehearsal, twice, from a clean state**
  > Hire three agents → autonomous spends visible live → one over-cap request held and approved →
  > one agent revoked while the other two keep working. Beat 6 (isolation) is the one that proves
  > "roster" rather than "single agent" and the easiest to fumble live. Rehearse it specifically.

- [ ] **13. Demo video**

---

## Cut list, in order, if time runs short

1. Payroll / recurring top-up (checkpoint 10) — open question 4 already suspects it doesn't change what the demo proves
2. Third demo agent — two agents make the isolation point (open question 3)
3. Bazantic recipe (checkpoint 12) — a whole $1,000 track, but only if 1–11 are solid
4. ~~ERC-8004 agent identity~~ — dropped 2026-09-11; adds no functional benefit (DECISIONS.md)
