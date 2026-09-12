# Demo video — 4:00

Checkpoint 13. Slides live in `docs/demo/slides.html` (arrow keys, `N` for narration, `F` for
fullscreen; on-screen chrome auto-hides after two seconds so a recording stays clean).

**Shape:** 1:22 of slides, 2:30 of screen, an 8s end card. Five slides, all of them bookends — the
video never cuts back to a deck once it has shown the product working.

**Narration budget:** ~145 words per minute → **about 570 words total**. Over-writing the script is
the single most common way a 4:00 video becomes 5:30.

---

## The story

> I run a one-person research product. Five agents do the work, and all five of them spend money to
> do it — search queries, model calls, data pulls, and every so often a human. Hundreds of payments
> a day, nearly all of them under a dollar.
>
> I can't approve each one; that's the whole point of hiring them. And I can't find out at the end
> of the month either — that's how you get a $4,000 bill from an agent stuck in a retry loop.

Why this story and not a watch dealer: every judge in the room has personally been burned by a
runaway API bill, so the stakes need no setup. It also makes per-call payment the *normal* case
rather than a contrivance, which is exactly what x402 is for.

The five agents keep their names, with the roles re-pointed:

| Agent | Does | Pays |
|---|---|---|
| **Scout** | sources and monitors | search APIs |
| **Pricer** | market and comparable data | data APIs |
| **Concierge** | answers customer questions | inference |
| **Runner** | one-off human work and paid datasets | people, marketplaces |
| **Ledger** | bookkeeping | — |

**Over-limit beat:** Runner needs **$120** to commission a human annotator for one job — over its
**$75** per-purchase limit. Held.

**Kill-switch beat:** Concierge gets stuck retrying a paid endpoint. Revoked on the spot. Its next
payment is refused; Scout and Pricer keep working in the same block.

---

## The clock

Four slides (1:32), then the screen for the rest. There is no closing slide — the video ends on the
demo's last beat, which is the strongest one.

| # | Block | In → out | Len | On screen | Words |
|---|---|---|---|---|---|
| S1 | Title | 0:00 → 0:10 | 10s | Slide 1 | 25 |
| S2 | Agentic payments today | 0:10 → 0:28 | 18s | Slide 2 | 43 |
| S3 | The problem | 0:28 → 0:56 | 28s | Slide 3 | 74 |
| S4 | The solution | 0:56 → 1:32 | 36s | Slide 4 | 93 |
| D1 | The team | 1:32 → 1:54 | 22s | Overview | 55 |
| D2 | Hire an agent | 1:54 → 2:12 | 18s | Hire form → progress row | 43 |
| D3 | It spends on its own | 2:12 → 2:47 | 35s | Activity feed + ArcScan | 88 |
| D4 | Over the limit | 2:47 → 3:09 | 22s | Banner → pending screen | 57 |
| D5 | I decide | 3:09 → 3:24 | 15s | Approve → released | 38 |
| D6 | Fire one agent | 3:24 → 4:00 | 36s | Revoke → refused → others fine | 97 |

**613 words at ~155 wpm** — relaxed talking speed, not presenting speed.

**Order: market, then problem.** The figures come first so the problem reads as an industry-sized
one rather than one founder's annoyance — most judges have never run five agents, so the pain does
not land cold. The two slides are joined by one sentence split across them: *"So the paying part is
solved."* ends S2, *"The managing part isn't."* opens S3. Don't drop it; without that hinge the
figures are trivia.

---

## The script

**Say it, don't read it.** Learn the shape of each block and then talk. The wording below is how it
should come out, not a teleprompter: if a different word arrives in the moment, use it. Contractions
throughout, and let the sentences run on a bit — a demo video should sound like you showing this to
one person sitting next to you, not like a voiceover.

The bold direction before each block is what's on screen, not something you say.

### S1 · Title — 0:00 → 0:10

> This is Bursar. A bursar is the person who runs the money at a school. If your staff are AI agents,
> nobody's doing that job.

### S2 · Agentic payments today — 0:10 → 0:28

> So agents paying each other isn't a future thing — it's already happening. About a hundred and
> sixty million payments have settled over x402 so far, and it's running sixteen million a month
> now. Nearly all of it USDC.
>
> So the paying part is solved.

### S3 · The problem — 0:28 → 0:56

> The managing part isn't. I run a one-person company where most of the staff are agents, and
> honestly, one agent is fine. Five is a mess.
>
> Every one of them has its own wallet that I'm topping up. Their spending's spread across wallets
> and invoices, so I genuinely can't tell you who spent what this week. And the limits I set?
> Nothing actually enforces them.
>
> Every agent I add makes all three of those worse.

### S4 · The solution — 0:56 → 1:32

> So that's what Bursar is. It's one place to run the whole team — hire them, set what each one's
> allowed to spend, and see everything they buy.
>
> Hiring is a name, a role, and two limits: how much it can spend on one thing, and how much in a
> month. I never touch a key. Then it goes and works — it pulls from the company balance for whatever
> the job needs, as long as it's inside those limits. Go over, and the payment just doesn't happen.
> It sits there waiting for me.
>
> And that limit isn't a setting in our app. It's in the contract holding the money.

### D1 · The team — 1:32 → 1:54

**Cut to the overview, five agents on it.**

> Okay, so here's the team. Five agents, what each one's spent this month, what it's still got left.
> And one balance underneath all of them — that's the company account, they all draw from it.
>
> Notice there's no wallet address anywhere on this screen. I don't hold a key for any of them.

### D2 · Hire an agent — 1:54 → 2:12

**Open the hire form, type, submit. Hold two seconds on the progress row, then cut to it finished.**

> Hiring one looks like this. Name, role, the two limits. I hit submit, and Bursar spins up the
> agent, gives it a wallet, and registers it on-chain with those limits. Takes about a minute —
> I'll skip ahead. There it is.

### D3 · It spends on its own — 2:12 → 2:47

**Agent buys something over x402; the feed updates live. Cut to ArcScan on that tx for three seconds.**

> Now let's watch one actually work. Scout wants to run a search. The service comes back with a
> 402 — pay me first. So Scout signs for it, the contract checks both limits, money moves. And
> notice: nobody asked me anything. I wasn't in that loop at all.
>
> Here's that exact payment on ArcScan. On Arc, in USDC, cost about a cent. And that's the boring
> case — it happens a few hundred times a day, and the whole point is that I never see it.

### D4 · Over the limit — 2:47 → 3:09

**The banner appears on the overview; click through to the pending screen.**

> Now Runner wants a hundred and twenty bucks to hire a human for a one-off job. Its limit is
> seventy-five. So watch — it doesn't go through. It's held.
>
> The contract turned it down right at the moment of payment. And now it's sitting on my screen:
> who asked, how much, what for, how far over.

### D5 · I decide — 3:09 → 3:24

**Approve. Show the release and the monthly figure move.**

> I can approve it or kill it. I'll approve. The hundred and twenty goes out, Runner buys what it
> needed, and it counts against its month. And that click is the signature — there's no second pop-up.

### D6 · Fire one agent — 3:24 → 4:00

**Concierge looping. Revoke it. Then the refusal and the other agents' spends, side by side.**

> Okay, last thing, and this is the one I actually care about. Concierge is stuck in a loop,
> hammering a paid endpoint. Normally this is the bit where I'm frantically rotating keys.
>
> Here, I just fire it. Done.
>
> Next payment it tries — refused. By the contract, with its own error. And look at this: Scout and
> Pricer both spent in that same block. Completely untouched. Firing an agent writes one agent's
> storage, so it physically can't reach the others.
>
> That's the difference between a dashboard watching your agents, and a contract holding the money.

---

## Rules the script is built on

**Never say the agents are "paid".** They are not on salary and they hold nothing standing. They
draw on the company balance to buy what the job needs, at the moment they need it, inside their own
limits. Say "spend", "draw", "buy" — never "pay the agent", "allowance", or "fund the agent".

**Bursar is a management platform, not a spending limit.** The problem is team-shaped — payroll,
books, control across many agents — and contract enforcement is *why it holds*, not what it is.

**The kill switch lives only in D6.** It is off the slides entirely, so that beat is the one and
only place a judge sees per-agent isolation — the strongest differentiator, and PRD risk R5. It has
40 seconds and the last word of the video for that reason. Do not let it slip.

---

## The story behind it

> I run a one-person research product. Five agents do the work, and all five spend money to do it —
> search queries, model calls, data pulls, and every so often a human. Hundreds of payments a day,
> nearly all under a dollar. I can't approve each one. I can't find out at the end of the month
> either — that's how you get a $4,000 bill from an agent stuck in a retry loop.

Every judge has been burned by a runaway API bill, so the stakes need no setup, and per-call payment
becomes the normal case instead of a contrivance. The five agents keep their names:

| Agent | Does | Pays |
|---|---|---|
| **Scout** | sources and monitors | search APIs |
| **Pricer** | market and comparable data | data APIs |
| **Concierge** | answers customer questions | inference |
| **Runner** | one-off human work and paid datasets | people, marketplaces |
| **Ledger** | bookkeeping | — |

---

## If it runs long

Cut in this order. Each cut is self-contained; none breaks the argument.

1. **D2, the hire (−18s).** The overview already shows five hired agents. Losing this loses the
   Privy / Managed-Agents onboarding story but nothing about enforcement.
2. **Trim D3 to 25s (−10s).** One purchase instead of two; keep the ArcScan shot.
3. **Cut S2, the figures (−18s).** Last resort — they are what make the problem look industry-sized
   rather than personal.

Never cut D4 → D6. Over-limit, approve, fire is the product.

---

## Before recording

- Reset to a clean state and run `pnpm --filter @roster/api seed` so the dashboard reads the way the
  script describes it. **The seed's memos and roles still say watches** — retarget them before the
  take (`apps/api/scripts/seed.ts`), along with the org name in the web shell.
- Rehearse twice end to end (backlog checkpoint 11), timing D6 specifically.
- D4's narration says "$120 against a $75 limit". Match the seed to it, or change the words.

---

## Sources for slide 2

| Figure | Source |
|---|---|
| 160M cumulative x402 payments (by June 2026, >90% on Base) | Chainalysis, via Crypto Briefing |
| 14–17.8M payments in a 30-day window (≈Aug 2026) | Crypto Briefing |

Narrated but not on the slide: USDC is 99.99% of agentic transfer volume over 90 days, and x402
moved to the Linux Foundation in April 2026. PRD §2's 2.9M/month and its derived 4,000–12,000
approval-hours are stale by roughly 5× and should be updated to match.
