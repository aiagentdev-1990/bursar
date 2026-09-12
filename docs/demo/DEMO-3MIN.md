# Bursar — 3-minute demo

**Ellis Research.** I sell competitive intelligence on the AI tooling market. It's me and five
agents, and the entire product is assembled out of things they buy. Today is Thursday — the brief
ships today.

471 words, ~3:00 at a relaxed pace. `[bracketed]` is what's on screen, not something you say.

---

### 1 · The team — 0:00 → 0:20

**[Dashboard, roster overview]**

This is Ellis Research. I sell competitive intelligence on the AI tooling market, and it's me and
five agents.

Here's the whole team on one screen — what each one's spent this month, and what it's still allowed
to spend. They all draw from one balance, the company account. And there's no wallet address
anywhere on here. I don't hold a key for any of them.

### 2 · Hiring — 0:20 → 0:48

**[Hire form → submit → progress row → speed-ramp → the finished row]**

The brief goes out today and I'm still drafting it myself, so let's hire someone for that. A name, a
role, and two limits — the most it can spend on one purchase, and the most in a month.

When I submit, Bursar spins up a real Claude agent with the payment skill attached. It boots,
generates its own keypair inside its own sandbox, and reports back one thing: an address. Bursar
registers that address on-chain with the limits I set. I never see a key.

Takes a minute or two — skipping ahead.

### 3 · Its first job — 0:48 → 1:34

**[Cut to Claude — Analyst's session. Type the request. Watch it work → back to the feed → ArcScan]**

And here it is, in Claude. A real agent with its own session, hired sixty seconds ago.

For this demo I'm talking to it through Claude's own interface, because that's where it lives. In a
product you'd hand it work however you wanted — a queue, an API, a message in Slack. Today I'll just
ask.

The brief needs this week's launches. So it goes looking, finds a service that wants paying, and
gets back a four-oh-two — pay me first. It signs for it, and the contract checks both limits before
any money moves. Inside them, it pays, and the data comes back.

I hired that agent a minute ago and I haven't approved anything since. I wasn't in that loop at all.

And here's that exact payment on ArcScan. Settled on Arc, in USDC, gas about a cent.

### 4 · The log — 1:34 → 1:50

**[Activity page. Scroll a little. Hit an agent filter chip, then clear it.]**

Everything the team buys lands here. The whole morning — every payment, which agent made it, what it
was for, what it cost.

And none of this is our bookkeeping. It's read straight off the chain, so there's nothing in here I
could edit. And one payment is still waiting on me.

### 5 · Over the limit — 1:50 → 2:12

**[Click the held row → the pending screen]**

That one's Runner. Its job is buying human work, and the crawlers have flagged pricing pages they
can't read reliably — so Runner wants to put them in front of expert annotators. That costs more
than its per-purchase limit allows.

So it didn't go through. It's held. The contract refused it at the moment of payment, and now it's
sitting on my screen: who asked, how much, what for, and how far over.

### 6 · I decide — 2:12 → 2:24

**[Approve → the release, and the monthly figure moves]**

And that's a call I should be making — a judgment about the product, not a routine data pull. So I
approve. The money's released to Runner, and it counts against Runner's month. That click is the
signature; there's no second confirmation.

> **Alternative, if you'd rather not click Approve on camera at all.** Drop this beat, end beat 5
> with "…and how far over. And it stays there until I approve or reject it. Nothing moves until I
> do," and give the 12 seconds to the firing beat.

### 7 · Firing one agent — 2:24 → 3:00

**[Concierge looping → fire it, its row drops off the roster → back to the log: its refusal, and
the other agents' payments still landing]**

Last one, and it's the one I actually care about. Concierge answers subscriber questions against a
paid endpoint, and that endpoint is failing — so it's stuck retrying. Every retry costs a fraction
of a cent, forever. This is the runaway bill everyone's had.

On any other setup I'd be rotating keys right now. Here, I just fire it — and it's off the team.

Next payment it tries — refused, by the contract, with its own error. And look at the log: Scout and
Pricer are still buying, in the same block, untouched, because the brief still has to ship today.
Firing an agent writes one agent's record, so it can't reach the others.

That's the difference between a dashboard that watches your agents, and a contract that holds the
money.

---

## Before recording

- The new hire is **Analyst**, role "Drafts the weekly brief", limits $0.30 per purchase / $2 a
  month — in line with the others at testnet scale.
- Beat 5 says "more than its per-purchase limit allows" rather than naming figures, so it survives
  whatever the seed holds. The live held request is $1.20 against Runner's $0.75.
- Beat 2 must be speed-ramped. Hold two seconds on the progress row, then cut.
- Beat 3 cuts to Claude and drives the agent from its own session, so have that window ready and
  signed in before you start. It runs the agent hired in beat 2, so the two have to be shot in order. Analyst buys
  `/v1/launches` from the seller ($0.006, well inside its $0.30 per-purchase limit) — the service
  returns the week's launches in a category, which is the raw material for the brief.
- Beat 7 is the only place isolation appears. Rehearse it specifically — and end it on the activity
  log rather than the roster, so the refusal and the other agents' payments are in one frame.
- Beat 4 is the only beat with no state change. Keep the cursor moving: scroll, filter by one agent,
  clear it. A static screen for eighteen seconds reads as dead air.
- **Approve works on-chain** — the server action waits for the receipt and the dashboard updates.
  What is *not* guaranteed on camera is the agent then completing its purchase: `POST
  /pending/:id/approve` tries to resume the agent's Claude session afterwards and returns a
  `resumed` flag, which is false when no session is live. The script says the money is released,
  and stops there.
