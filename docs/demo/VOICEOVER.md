# Bursar — voiceover script

Read straight through. 613 words, about 4:00 at a relaxed pace. `[bracketed]` lines are what's on
screen, not something you say.

Say it rather than read it where you can — if a different word arrives in the moment, use it.

---

**[SLIDE 1 — title]** · 0:00

This is Bursar. A bursar is the person who runs the money at a school. If your staff are AI agents,
nobody's doing that job.

**[SLIDE 2 — the figures]** · 0:10

So agents paying each other isn't a future thing — it's already happening. About a hundred and sixty
million payments have settled over x402 so far, and it's running sixteen million a month now. Nearly
all of it USDC.

So the paying part is solved.

**[SLIDE 3 — the problem]** · 0:28

The managing part isn't. I run a one-person company where most of the staff are agents, and
honestly, one agent is fine. Five is a mess.

Every one of them has its own wallet that I'm topping up. Their spending's spread across wallets and
invoices, so I genuinely can't tell you who spent what this week. And the limits I set? Nothing
actually enforces them.

Every agent I add makes all three of those worse.

**[SLIDE 4 — the solution]** · 0:56

So that's what Bursar is. It's one place to run the whole team — hire them, set what each one's
allowed to spend, and see everything they buy.

Hiring is a name, a role, and two limits: how much it can spend on one thing, and how much in a
month. I never touch a key. Then it goes and works — it pulls from the company balance for whatever
the job needs, as long as it's inside those limits. Go over, and the payment just doesn't happen. It
sits there waiting for me.

And that limit isn't a setting in our app. It's in the contract holding the money.

**[CUT TO THE DASHBOARD]** · 1:32

Okay, so here's the team. Every agent, what each one's spent this month, what it's still got left.
And one balance underneath all of them — that's the company account, they all draw from it.

Notice there's no wallet address anywhere on this screen. I don't hold a key for any of them.

**[HIRE FORM → submit → skip the wait]** · 1:54

Hiring one looks like this. Name, role, the two limits. I hit submit, and Bursar spins up the agent,
gives it a wallet, and registers it on-chain with those limits. Takes about a minute — I'll skip
ahead. There it is.

**[AN AGENT SPENDS → then ArcScan]** · 2:12

Now let's watch one actually work. Scout wants to run a search. The service comes back with a
four-oh-two — pay me first. So Scout signs for it, the contract checks both limits, money moves. And
notice: nobody asked me anything. I wasn't in that loop at all.

Here's that exact payment on ArcScan. Settled on Arc, in USDC, and the gas cost about a cent. That's
the boring case — it happens a few hundred times a day, and the whole point is that I never see it.

**[THE BANNER → the pending screen]** · 2:47

Now Runner wants to spend a dollar twenty to commission a human for a one-off job. Its limit is
seventy-five cents. So watch — it doesn't go through. It's held.

The contract turned it down right at the moment of payment. And now it's sitting on my screen: who
asked, how much, what for, how far over.

**[APPROVE]** · 3:09

I can approve it or kill it. I'll approve. The dollar twenty goes out, Runner buys what it needed,
and it counts against its month. And that click is the signature — there's no second pop-up.

**[FIRE CONCIERGE → the refusal → the others still spending]** · 3:24

Okay, last thing, and this is the one I actually care about. Concierge is stuck in a loop, hammering
a paid endpoint. Normally this is the bit where I'm frantically rotating keys.

Here, I just fire it. Done.

Next payment it tries — refused. By the contract, with its own error. And look at this: Scout and
Pricer both spent in that same block. Completely untouched. Firing an agent writes one agent's
storage, so it physically can't reach the others.

That's the difference between a dashboard watching your agents, and a contract holding the money.

**[END — 4:00. No closing slide.]**
