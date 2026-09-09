# UI mockups

Four reference screens for checkpoint 8. The JPGs are the source of truth for layout; this file
transcribes the copy and structure so it can be diffed and searched without opening an image.

| File | Screen |
|---|---|
| `1-roster-overview.jpg` | Roster overview — the day-to-day screen |
| `2-pending-approval.jpg` | Pending approval detail — the over-cap moment |
| `3-hire-an-agent.jpg` | Hire an agent — modal over the overview |
| `4-activity.jpg` | Activity — the full payment log |

---

## Design system

- **Theme:** dark only. Near-black page ground, slightly lighter raised panels, hairline dividers.
- **Accent:** a single indigo/periwinkle, used for the logo mark, nav active state, the primary
  button, sparklines, progress-bar fill, and the "Held · review" pill. Nothing else is coloured.
- **Type:** one sans family. Section eyebrows are small-caps, letterspaced, muted grey. Hero
  figures are very large and light-weight. Body and table text sit at two greys — primary white,
  secondary muted.
- **Status pills:** small, rounded, low-contrast. Grey fill for settled/active states, accent
  outline for anything awaiting the owner.
- **Money:** always two decimals with a `$` prefix (`$1,526.00`), except round cap figures in
  secondary position (`$400 cap`, `of $2,250 committed`).

## Shell (every screen)

- Left: square accent logo mark, wordmark **Roster**, then the org name in small-caps muted grey
  (`ELLIS WATCH CO.`).
- Right: nav `Roster` · `Activity` · `Settings` (active item in accent), then a primary
  outlined button `+ Hire an agent`.

---

## 1. Roster overview

- Eyebrow `ROSTER SPEND · SEPTEMBER 2026`; hero `$1,526.00` with `of $2,250 committed` inline.
- Stat row, right-aligned: `AGENTS 5` · `AWAITING APPROVAL $120.00` · `UNSPENT $724`.
- Alert banner (raised panel, ⓘ icon), shown only when something is pending:
  > **Runner is holding a $120.00 payment for your approval**
  > $45.00 above its $75.00 per-transaction limit. Every other agent is spending normally.

  with a `Review request →` button on the right. The second sentence is doing real work — it's the
  isolation guarantee stated in the UI.
- Agent table. Columns: `AGENT` (name + role description on a second line) · `CATEGORY` ·
  `TREND` (sparkline) · `SPENT THIS PERIOD` (amount left, `$400 cap` right, progress bar beneath) ·
  `STATUS` (pill) · `LAST ACTIVITY` (relative time) · overflow `…`.
- Rows seen: Pricer (Comparable-listing research, Data & research, $268.00 / $400 cap, Active),
  Concierge (Buyer questions and offers, Messaging, $41.00 / $150 cap, Active),
  Runner (Contract…, …, Needs…).

## 2. Pending approval

- Back link `← Roster`.
- Eyebrow `PENDING APPROVAL · OVER CAP`; hero `$120.00` with `to Verity Watch Authentication` inline.
- Purpose paragraph in full prose, not a memo field:
  > Pre-purchase authentication on an Omega Speedmaster ref. 145.022 — movement inspection and
  > case verification before the seller is paid.
- Four-cell detail strip: `REQUESTED BY` (Runner / One-off task payouts) · `CATEGORY`
  (Authentication / Today, 09:12) · `PER-TRANSACTION LIMIT` ($75.00 / $45.00 over) ·
  `MONTHLY CAP AFTER` ($732 / of $900).
- Consequence callout above the action buttons:
  > Approving settles $120.00 to Verity Watch Authentication immediately — there is no second
  > confirmation, and it counts against Runner's September cap.

  This is the screen's most important line. It tells the owner the approval *is* the signature.

## 3. Hire an agent

Modal over a dimmed overview.

- Title `Hire an agent`; subtitle `It joins the roster with these caps live from the first transaction.`
- Preset chips: `Research · $50 / $300` · `Payouts · $75 / $900` · `Support · $25 / $150`.
- Fields: `Name` (placeholder `e.g. Courier`) and `Role` (placeholder `What it is allowed to do`)
  side by side; `Per-transaction cap` and `Monthly cap` side by side, numeric, bare numbers.
- Live plain-language summary that updates with the inputs:
  > Spends up to $75 at a time, $400 a month. Anything larger waits for you.
- Actions: `Cancel` · `Add to roster`.

Note the whole form is four fields and no address — that's the §4.1 "owner never sees a wallet
address" requirement showing up in the UI.

## 4. Activity

- Eyebrow `ACTIVITY · SEPTEMBER 2026`; hero `$441.40` with `settled across 10 transactions`.
- Stat row: `HELD FOR APPROVAL $120.00` · `REJECTED $210.00` · `LARGEST PAYMENT $180.00`.
- Filter chips: `All agents` (active) · `Pricer` · `Concierge` · `Runner` · `Scout` · `Ledger`.
- Right-aligned note: `Every payment an agent made, in order. Nothing here can be edited.`
- Day-grouped rows. Group header is the date (`TODAY · 8 SEPTEMBER`) with the day's settled
  subtotal right-aligned (`$58.40 settled`).
- Row: time · agent · payee + memo on a second line · category · amount · status pill.
- Rows seen: 09:12 Runner / Verity Watch Authentication / "Pre-purchase authentication, Omega ref.
  145.022" / Authentication / $120.00 / `Held · review`; 08:58 Pricer / Chrono24 Data /
  "Comparable sold-listing pull" / Data & research / $14.00 / `Settled`; 08:20 Concierge / Twilio /
  "Buyer SMS, 240 messages" / Messaging / $6.40 / `Settled`; 07:05 Scout / Invaluable /
  "Auction alert feed, weekly" / Sourcing / $38.00 / `Settled`.

---

## Discrepancies with the PRD — **all five resolved 2026-09-09**

See `docs/DECISIONS.md` for the resolutions and the reasoning; PRD §7 has been updated to match.
Kept below as the record of what the conflict was.

1. ~~**Agent count.**~~ *Resolved: five on the roster, three driven live.* The mockups show **five** agents (Pricer, Concierge, Runner, Scout, Ledger).
   PRD §7's demo narrative has **three**, and open question 3 asks whether even three is one too
   many for a live demo. Five is almost certainly a mockup-realism choice, not a spec.
2. ~~**Agent names.**~~ *Resolved: mockup names.* Mockups use product names (Pricer, Concierge, Runner, Scout, Ledger); the PRD
   uses functional descriptions (pricing agent, support agent, fulfillment agent). Roughly:
   Pricer ≈ pricing, Concierge ≈ support, Runner ≈ fulfillment. Scout and Ledger have no PRD
   counterpart at all. The mockup names are better — use them.
3. ~~**Period wording.**~~ *Resolved: monthly — `periodLength` is fixed at 30 days, a constraint on checkpoint 1.* The UI says "Monthly cap" and "September cap" throughout; the contract's
   field is `perPeriodCap` with a configurable `periodLength`, and the PRD demo uses **weekly**
   caps ($100/week, $50/week, $400/week). Either set `periodLength` to a month for the demo, or
   change the UI copy to "period". Do not let the UI imply a boundary the contract isn't enforcing.
4. ~~**Demo numbers.**~~ *Resolved: mockup figures; Scout $500 and Ledger $300 chosen so the derived totals balance.* Mockup caps (Pricer $400, Concierge $150, Runner $75/$900) differ from PRD
   §7's ($10/$100, $5/$50, $75/$400). The $120 over-cap moment against a $75 per-transaction limit
   is consistent across both — that beat is settled; the surrounding figures aren't.
5. ~~**Category vs role.**~~ *Resolved: derived from role in the UI (`apps/web/lib/categories.ts`); the contract stays single-field.* The table has a `CATEGORY` column (Data & research, Messaging,
   Authentication, Sourcing) *and* a role description under each agent name. The contract carries
   one `role` string. Either category is derived from role, or the backend stores a second field
   the contract doesn't know about — decide which.
