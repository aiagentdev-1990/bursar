# Bursar — 3-minute demo

**Ellis Research.** I sell competitive intelligence on the AI tooling market. It's me and five
agents, and the entire product is assembled out of things they buy. Today is Thursday — the brief
ships today.

465 words, ~3:00 at a relaxed pace. `[bracketed]` is what's on screen, not something you say.

---

### 1 · The team — 0:00 → 0:22

**[Dashboard, roster overview]**

This is Ellis Research. I sell competitive intelligence on the AI tooling market, and it's me and
five agents.

This is the whole team on one screen — what each one's spent this month, and what it's still allowed
to spend. They all draw from one balance, the company account. And notice there's no wallet address
anywhere on here. I don't hold a key for any of them.

### 2 · Hiring — 0:22 → 0:55

**[Hire form → submit → progress row → speed-ramp → the finished row]**

The brief goes out today and I'm still drafting it myself, so let's hire someone for that. A name, a
role, and two limits — the most it can spend on one purchase, and the most in a month.

When I submit, Bursar spins up a real Claude agent with the payment skill attached. That agent
boots, generates its own keypair inside its own sandbox, and reports back exactly one thing: an
address. Bursar registers that address on-chain with the limits I just set. I never see a key.

Takes a minute or two — skipping ahead. And there's Analyst, on the team.

### 3 · It spends on its own — 0:55 → 1:33

**[An agent pays over x402, feed updates live → cut to ArcScan for ~3s]**

Now let's watch one work. Scout watches competitor pricing pages, and to do that it has to pay for a
crawl. It calls the service, gets back a four-oh-two — pay me first — signs for it, and the contract
checks both limits before any money moves. Inside them, it pays, and the crawl comes back.

Nobody asked me anything. I wasn't in that loop at all.

And here's that exact payment on ArcScan. Settled on Arc, in USDC, gas about a cent. That's the
ordinary case, a few hundred times a day, and the whole point is that I never see it.

### 4 · Over the limit — 1:33 → 2:01

**[Banner on the overview → click through to the pending screen]**

Here's one I do see. Runner's job is buying human work, and the crawlers have flagged pricing pages
they can't read reliably — so Runner wants to put them in front of expert annotators. That costs
more than its per-purchase limit allows.

Watch — it doesn't go through. It's held. The contract refused it at the moment of payment, and now
it's sitting on my screen: who asked, how much, what for, and how far over.

### 5 · I decide — 2:01 → 2:18

**[Approve → the release, and the monthly figure moves]**

And that's a call I should be making — it's a judgment about the product, not a routine data pull.
So I approve. The money's released to Runner, and it counts against Runner's month. That click is
the signature; there's no second confirmation.

> **Alternative, if you'd rather not click Approve on camera at all.** Drop this beat, end beat 4
> with the line below, and give the 17 seconds to the firing beat (which becomes 2:01 → 3:00):
>
> "...who asked, how much, what for, and how far over. And it stays there until I approve or reject
> it. Nothing moves until I do."

### 6 · Firing one agent — 2:18 → 3:00

**[Concierge looping → fire it, its row drops off the roster → the refusal, and the others still
spending]**

Last one, and it's the one I actually care about. Concierge answers subscriber questions against a
paid endpoint, and that endpoint is failing — so it's stuck retrying. Every retry costs a fraction
of a cent, forever. This is the runaway bill everyone's had.

On any other setup I'd be rotating keys right now. Here, I just fire it — and it's off the team.

Next payment it tries — refused, by the contract, with its own error. And look: Scout and Pricer
both spent in that same block, untouched, because the brief still has to ship today. Firing an agent
writes one agent's record, so it can't reach the others.

That's the difference between a dashboard that watches your agents, and a contract that holds the
money.

---

## Before recording

- The new hire is **Analyst**, role "Drafts the weekly brief", limits $0.30 per purchase / $2 a
  month — in line with the others at testnet scale.
- Beat 4 says "more than its per-purchase limit allows" rather than naming figures, so it survives
  whatever the seed holds. The live held request is $1.20 against Runner's $0.75.
- Beat 2 must be speed-ramped. Hold two seconds on the progress row, then cut.
- Beat 6 is the only place isolation appears. Rehearse it specifically.
- **Approve works on-chain** — the server action waits for the receipt and the dashboard updates.
  What is *not* guaranteed on camera is the agent then completing its purchase: `POST
  /pending/:id/approve` tries to resume the agent's Claude session afterwards and returns a
  `resumed` flag, which is false when no session is live. The script says the money is released,
  and stops there.
