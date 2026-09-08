# Decisions

Settled questions, so they don't get relitigated. Newest first. Add the date and the reason.

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
- Three demo agents or two?
- Keep "payroll" (recurring top-up) or cut it?
