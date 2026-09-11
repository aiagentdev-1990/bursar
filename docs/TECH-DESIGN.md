# Roster — Technical Design

*Version 0.1 (draft) · 8 September 2026 · Companion to PRD.md*

---

## 1. Background

Roster is a financial control layer for AI agents: a solo founder or small business owner registers each agent with a spending allowance (a per-transaction cap and a per-period cap), enforced on-chain. Agents draw against their allowance autonomously for anything inside those limits. Anything over either cap holds in a pending state until the owner approves or rejects it. The owner can revoke any single agent's access instantly, with no effect on the rest of the roster.

The system deploys entirely on **Arc testnet** (chain id `5042002`), settles agent payments via **x402** through Circle's Arc-testnet facilitator (MPP is explicitly out of scope — no confirmed Arc settlement path exists for it today), and provisions each agent's wallet automatically through **Privy**, so an owner never handles a private key or a raw address. Funding — both the owner's initial deposit and recurring "payroll" top-ups — can pull USDC from wherever the owner actually holds it via **Circle Unified Balance / Bridge Kit**, consolidating into Arc without a manual bridge step.

## 2. Requirements

| ID | Requirement |
|---|---|
| R1 | Owner can register a new agent with a role, a per-transaction cap, and a per-period cap, in one step, without entering an address |
| R2 | An agent's payment is rejected by the contract if it exceeds the per-transaction cap |
| R3 | An agent's cumulative spend is tracked against its per-period cap and resets automatically at the period boundary |
| R4 | An agent can call a payment function directly; funds release immediately with no owner signature if both caps are satisfied |
| R5 | The payment function is exposed as an x402-compatible endpoint, settled via Circle's Arc-testnet facilitator |
| R6 | A payment that exceeds either cap is held in a pending state — never silently dropped, never force-executed |
| R7 | Owner can view a pending request's amount, payee, and purpose, and approve or reject it in one action |
| R8 | Owner can revoke or reduce one agent's allowance at any time, with zero effect on any other agent |
| R9 | Owner can view every agent's role, budget status, and recent activity from a single dashboard |
| R10 | Owner can schedule a recurring allowance top-up for an agent, funded from USDC held on any chain, not just Arc |
| R11 | The allowance-check/payment endpoint is discoverable by external agent frameworks (Bazantic) |

### 2.1 Requirement → Mechanism map

| Requirement | Mechanism section |
|---|---|
| R1 | §4.1 Agent onboarding |
| R2, R3, R4, R5 | §4.2 Autonomous payment (within cap) |
| R6, R7 | §4.3 Above-cap payment → pending approval |
| R8 | §4.4 Revocation |
| R9 | §4.5 Dashboard & activity feed |
| R10 | §4.6 Funding & recurring top-up |
| R11 | §4.7 External discovery |

## 3. High-level overview

```mermaid
flowchart LR
    Owner((Owner))
    Agent((Agent))

    Owner --> Dashboard[Roster Dashboard]
    Dashboard --> Backend[Roster Backend]
    Backend --> Privy[Privy Wallet API]
    Backend --> BridgeKit[Circle Bridge Kit /\nUnified Balance]
    Backend --> Contract[(Allowance Contract\nArc Testnet)]

    Agent --> Contract
    Contract --> Facilitator[Circle x402\nArc-Testnet Facilitator]
    Facilitator --> Service[[Third-party x402 service\ne.g. Brave Search, Groq, molty.cash]]

    Contract --> Blockscout[Blockscout API]
    Blockscout --> Dashboard

    BridgeKit --> Contract
```

Five components own the system's behaviour:

- **Allowance Contract (Arc)** — the single source of truth for caps, pending state, and revocation. Every other component reads from or writes to it; nothing enforces a limit anywhere else.
- **Roster Backend** — the only component that talks to Privy and Bridge Kit. It never holds funds or signs payments on an agent's behalf; it only orchestrates provisioning and funding.
- **Privy** — mints a real wallet per agent with no manual key handling.
- **Circle's Arc-testnet x402 facilitator** — verifies and settles agent payments against real x402 services.
- **Blockscout** — the read layer. The dashboard never queries the contract directly for history; it reads Blockscout's indexed event log.

## 4. Mechanisms

### 4.1 Agent onboarding ("hire an agent")

Hiring provisions a **wallet** (Privy), an **allowance** (the Allowance Contract), and a **running
instance** (Claude Managed Agents). The agent generates its own signing credential, so nothing
else — the backend included — can act as it.

No ERC-8004 identity. It was evaluated and dropped: it adds nothing functional to Roster. See
DECISIONS.md 2026-09-11.

#### Keys

| Key | Held by | Can |
|---|---|---|
| Wallet key (secp256k1) | Privy, never leaves its enclave | Sign transactions |
| Owner authorization key (P-256) | Roster backend | Create wallets, manage signers |
| Signer authorization key (P-256) | The agent, generated in its sandbox | Ask Privy to sign for its own wallet only |

A signer cannot change the wallet's owner or signers and cannot export its key. The agent is never
given `PRIVY_APP_SECRET`: that secret is app-wide, so any agent holding it could transact from any
other agent's wallet.

#### The flow

```mermaid
sequenceDiagram
    autonumber
    actor Owner
    participant Backend as Roster Backend
    participant Agent as Agent session (Claude)
    participant Privy
    participant Roster as Allowance Contract

    Owner->>Backend: Hire (name, role, perTxCap, perPeriodCap)
    Backend->>Agent: create session - Agent config per role, cached, skill attached
    Backend->>Agent: generate your key, reply with AGENT_PUBLIC_KEY
    Note over Agent: generates a P-256 keypair<br/>private half stays in the sandbox
    Agent-->>Backend: message: AGENT_PUBLIC_KEY base64 DER
    Backend->>Backend: validate - P-256 SPKI prefix, exactly 91 bytes

    Backend->>Privy: POST /v1/key_quorums (agent public key)
    Backend->>Privy: POST /v1/wallets (owner = backend key, signer = agent quorum)
    Privy-->>Backend: wallet id + address
    Backend->>Backend: send native USDC for gas, 18 decimals

    Backend->>Roster: hireAgent(wallet, perTxCap, perPeriodCap, name + role)
    Roster-->>Backend: AgentRegistered - caps enforced from here
    opt opening earmark requested
        Backend->>Roster: fundAgent(wallet, amount)
    end

    Backend->>Agent: your walletAddress + privyWalletId
    Backend-->>Owner: Agent hired, capped, and running
```

- **Hiring is asynchronous.** It waits on the agent's reply, and the agent may stall, decline, or
  reply without a usable key. The backend validates the key strictly and times out.
- **Nothing on-chain happens until the agent has produced a valid key.** A failure before
  `hireAgent` leaves no agent on the roster. From `hireAgent` on, the caps are enforced.
- **Two separate fundings.** Gas is native USDC at 18 decimals, sent to the wallet. The allowance
  is ERC-20 USDC at 6 decimals, earmarked in the contract by `fundAgent`.
- **Name and role** travel in the contract's `role` string as `Name|Role`.

**Why Agent and Environment are separate from Session:** Agent and Environment are versioned,
reusable resources — a role is defined once and every hire of that role reuses the same
`agent_id`. A Session is one running instance, tied to one hire.

**Creating a session doesn't start work.** The backend has to send a user event to set it going.

The owner never sees a wallet address or an agent ID. `hireAgent` is `onlyOwner`.

#### Open

- **Key persistence.** The sandbox filesystem does not survive a session, and memory stores are
  explicitly not for credentials. A second session finds no key.
- **Privy authentication.** Whether `/v1/wallets/{id}/rpc` also needs Basic auth with the app
  secret alongside the authorization signature is unverified. If it does, this design fails,
  because the agent must never hold the app secret.

### 4.2 Autonomous payment, within cap

The contract is a treasury, not just a gate — it holds the USDC (funded via §4.6) and releases it to the agent's own wallet once the caps clear. The agent's wallet then does the actual x402 signing itself.

```mermaid
sequenceDiagram
    participant Agent as Agent (Privy wallet)
    participant Contract as Allowance Contract (Arc)
    participant Service as Third-party x402 service
    participant Facilitator as Circle Arc-Testnet Facilitator

    Agent->>Service: Request resource
    Service-->>Agent: 402 Payment Required (amount, payee)
    Agent->>Contract: executeSpend(amount, payee, memo)
    Contract->>Contract: amount <= perTxCap AND periodSpend + amount <= perPeriodCap
    Contract->>Agent: Transfer amount (USDC) to agent's own wallet
    Contract-->>Agent: SpendExecuted event
    Agent->>Agent: Sign EIP-3009/Permit2 payment authorization
    Agent->>Facilitator: Retry request with signed payment header
    Facilitator->>Facilitator: Verify signature, settle on-chain
    Facilitator-->>Service: Payment confirmed
    Service-->>Agent: Resource delivered
```

No owner signature anywhere in this path. `executeSpend` is `onlyAgent`.

**`payee` is advisory.** Both `executeSpend` and `approvePending` transfer to the *agent's own
wallet*, never to the payee — the agent signs the x402 payment itself. The payee recorded on a
spend or a pending request is the agent's declaration of intent; the contract does not verify it
and cannot enforce it. The cap is the guarantee, the destination is not, and owner-facing copy
must not imply otherwise.

**How the agent signs.** The agent holds the P-256 authorization key it generated in §4.1; the
wallet's blockchain key stays in Privy. Its `roster-payments` skill calls Privy from inside the
sandbox — `POST /v1/wallets/{id}/rpc` with `eth_sendTransaction` — authenticating each request with
that key, to submit `executeSpend` and to sign x402 payment headers. The skill is uploaded once
via the Skills API and attached to each role's Agent config.

**Timing matters.** `executeSpend` fires immediately before the agent retries the x402 request, not ahead of time as a batch top-up — that bounds the released-but-unspent window to a single request.

**Failure case: release succeeds but the x402 payment doesn't.** The USDC stays in the agent's wallet and counts against its period cap. Nothing reclaims it today — `sweepUnspent` was removed (see §5). The point-of-use release above is what keeps this bounded: at most one request's worth is ever stranded, rather than an accumulating balance. Reclaiming it needs an ERC-20 allowance from the agent's wallet, which §4.1's onboarding would have to establish first.

### 4.3 Above-cap payment → pending approval

```mermaid
sequenceDiagram
    participant Agent
    participant Contract as Allowance Contract (Arc)
    participant Backend as Roster Backend
    participant Owner
    participant Claude as Claude Managed Agents API

    Agent->>Contract: executeSpend(amount, payee, memo)
    Contract->>Contract: amount > perTxCap (or periodSpend + amount > perPeriodCap)
    Contract-->>Agent: No funds released — PaymentPending event (requestId)
    Backend->>Contract: Listen for PaymentPending
    Backend-->>Owner: Notify — pending approval, with amount/payee/purpose

    Owner->>Backend: Approve requestId
    Backend->>Contract: approvePending(requestId)
    Contract->>Agent: Transfer amount (USDC) to agent's own wallet
    Contract-->>Backend: SpendExecuted event
    Backend->>Claude: POST /v1/sessions/{id}/events (funds released, retry payment)
```

Rejection follows the same shape via `rejectPending(requestId)` — request closed, no funds move, no session event.

**Why the backend sends the session event directly:** it already knows the `requestId`, agent, and session at the moment of the click. `SpendExecuted` also fires from §4.2's ordinary path, so inferring "this one came from an approval" from the event stream would need extra state-tracking.

### 4.4 Revocation (kill switch)

```mermaid
sequenceDiagram
    participant Owner
    participant Backend as Roster Backend
    participant Contract as Allowance Contract (Arc)
    participant Agent

    Owner->>Backend: Revoke agent X
    Backend->>Contract: revokeAgent(address)
    Contract-->>Backend: AgentRevoked event
    Note over Contract: agent.active = false
    Agent->>Contract: executeSpend(...)
    Contract-->>Agent: Reverts — AgentNotActive
```

`revokeAgent` touches only that agent's record — isolation is a property of the storage layout (one struct per agent address), not application logic.

**What revocation does and doesn't cover.** It stops every *future* `executeSpend`, and it also blocks `approvePending` on any request that agent left outstanding — otherwise the kill switch would have a hole in it. It does not claw back USDC already released to that agent's wallet: the contract is non-custodial of funds once they've moved, and there is no sweep. What remains unearmarked stays in the treasury for the rest of the roster.

### 4.5 Dashboard & activity feed

```mermaid
sequenceDiagram
    participant Dashboard as Roster Dashboard
    participant Blockscout as Blockscout API (Arc)

    Dashboard->>Blockscout: GET /api/v2/addresses/{contract}/logs
    Blockscout-->>Dashboard: SpendExecuted, PaymentPending, Approved, Rejected, AgentRevoked events
    Dashboard->>Dashboard: Group by agent, compute budget-bar %, flag pending items
```

No separate indexer.

### 4.6 Funding & recurring top-up ("payroll")

```mermaid
sequenceDiagram
    participant Owner
    participant BridgeKit as Circle Bridge Kit / Unified Balance
    participant Contract as Allowance Contract (Arc)

    Owner->>BridgeKit: Schedule top-up (agent, amount, period)
    loop each period
        BridgeKit->>BridgeKit: Consolidate owner's USDC (any source chain)
        BridgeKit->>Contract: Deliver USDC to Arc
        Contract->>Contract: fundAgent(address, amount)
        Contract-->>Owner: AllowanceFunded event
    end
```

Bridge Kit's job ends the moment funds land on Arc.

### 4.7 External discovery (Bazantic)

The allowance-check used in §4.2 is exposed as a read-only recipe in Bazantic's registry, so an external agent framework can check whether a spend would clear before attempting it.

## Open technical questions

1. Does Circle's Agent Stack expose a testnet-ready SDK on Arc, or does §4.2's facilitator interaction need to be built against the raw x402 spec directly? *(Answered 2026-09-09: yes — `@circle-fin/x402-batching` v2 with `GatewayClient` / `BatchFacilitatorClient`. See the Gateway custody conflict noted against §4.2.)*
2. ~~Does `executeSpend`'s `onlyAgent` check bind to a plain contract address, or does agent identity need to resolve through ERC-8004?~~ *Settled 2026-09-11: a plain address. ERC-8004 was evaluated and dropped — DECISIONS.md.*

## 5. Smart contract functions

| Function signature | Access control | Purpose |
|---|---|---|
| `hireAgent(address agent, uint256 perTxCap, uint256 perPeriodCap, string calldata role)` | `onlyOwner` | Registers a new agent's wallet, its two caps, and its `Name\|Role` label. §4.1 |
| `initialize(address owner)` | Once, by the factory | Sets the owner. Replaces a constructor, which a minimal proxy cannot run. |
| `fundAgent(address agent, uint256 amount)` | `onlyOwner` | Earmarks USDC the Roster **already holds** for that agent. Moves no tokens. Reverts if the balance can't cover every earmark. §4.6 |
| `executeSpend(uint256 amount, address payee, bytes calldata memo) returns (bool executed, uint256 requestId)` | `onlyAgent` | Checks both caps. If satisfied, transfers `amount` to the agent's own wallet and returns `executed = true`. If not, opens a pending request. §4.2, §4.3 |
| `executeSpendFor(address agent, uint256 amount, address payee, bytes calldata memo, uint256 deadline, bytes calldata signature) returns (bool executed, uint256 requestId)` | Anyone, carrying the agent's EIP-712 signature | `executeSpend` relayed: same caps, same pending path, same events, funds still to the agent's wallet. The relayer pays gas, so the agent holds no USDC. Added 2026-09-11. |
| `nonces(address agent) view returns (uint256)` | Public | The nonce the agent's next `executeSpendFor` signature must carry. |
| `defundAgent(address agent, uint256 amount)` | `onlyOwner` | Returns an agent's earmark to the unallocated treasury. Counterpart to `fundAgent`. |
| `withdrawTreasury(address to, uint256 amount)` | `onlyOwner` | Moves unallocated USDC out. Bounded by `balance - totalEarmarked`, so it can never touch an earmark. |
| `approvePending(uint256 requestId)` | `onlyOwner` | Releases a held request's funds. §4.3 |
| `rejectPending(uint256 requestId)` | `onlyOwner` | Closes a held request with no funds moved. §4.3 |
| `revokeAgent(address agent)` | `onlyOwner` | Sets that agent's `active` flag false. Touches only that agent's record. §4.4 |
| `updateCaps(address agent, uint256 newPerTxCap, uint256 newPerPeriodCap)` | `onlyOwner` | Adjusts caps without a full revoke/re-hire (R8's "reduce" half). |
| `getAgent(address agent) view returns (AgentInfo memory)` | Public | Caps, role, active status, current period spend, earmarked balance. Applies the lazy reset to what it returns, so the period it reports is the one the next `executeSpend` will enforce. |
| `getPendingRequest(uint256 requestId) view returns (PendingRequest memory)` | Public | Amount, payee, memo, requesting agent. |
| `owner() / PERIOD_LENGTH() / totalEarmarked()` | Public | Owner, the fixed 30-day period, and the sum of every agent's earmark. |

**Note on period resets:** no `resetPeriod` function. `executeSpend` computes whether the current timestamp has crossed the agent's period boundary since its last recorded reset, and if so zeroes the period-spend counter before checking the cap. The period is a fixed `PERIOD_LENGTH = 30 days` for every agent on every Roster, not a per-agent field — see DECISIONS.md 2026-09-09. `periodStart` advances by whole periods, so an agent that goes quiet for three months does not get a fresh period beginning the moment it wakes up.

**Note on relayed spends (added 2026-09-11).** Gas on Arc is USDC, so an agent that sends its own
`executeSpend` needs a USDC float — and that float is money it can pay a seller with directly,
outside every cap. `executeSpendFor` removes the float: the agent signs
`Spend(agent, amount, payee, memo, nonce, deadline)` under EIP-712 domain
`{name: "Roster", version: "1", chainId, verifyingContract: <this Roster>}`, and any relayer
submits it. Each signature is good once (per-agent nonce), on one Roster (the clone's own address
is the domain), until its deadline, and never after a revoke (checked before the signature). The
nonce is a separate per-agent mapping, not an `AgentInfo` field, so `getAgent`'s shape is
unchanged and revocation still touches one struct. See DECISIONS.md 2026-09-11.

**Note on getting funds back out (added 2026-09-09).** `fundAgent` alone made an earmark a
one-way door: USDC delivered to the Roster but never earmarked was locked in it forever, and
revoking a funded agent stranded that agent's remaining budget permanently — which made the kill
switch cost real money. `defundAgent` and `withdrawTreasury` close both. The invariant they
preserve is `USDC.balanceOf(roster) >= totalEarmarked`: an agent always keeps what it was
promised, and only the surplus can leave.

**Note on `sweepUnspent`:** removed. It needed an ERC-20 allowance from the agent's wallet to the contract that §4.1's onboarding never established. Nothing reclaims released-but-unspent USDC today; the exposure is bounded to a single request by the point-of-use release in §4.2, which is what made the sweep optional in the first place. See DECISIONS.md 2026-09-09.

### 5.1 One Roster per team — `RosterFactory`

A Roster is one owner's team. `RosterFactory.createRoster(owner)` deploys each one as an EIP-1167 minimal proxy over a single implementation, so a new team costs a 45-byte deployment.

| Function | Purpose |
|---|---|
| `createRoster(address owner) returns (address)` | Deploy and initialize a Roster owned by `owner`. Permissionless. |
| `implementation()` | The shared Roster implementation. Locked at factory construction. |

**The factory keeps no registry (revised 2026-09-09).** It originally indexed rosters by owner.
But `createRoster` has to be permissionless — the backend deploys on an owner's behalf during
onboarding, so the caller is never the owner — which meant anyone could fill any address's list
with entries nobody asked for, unboundedly, until it was too large to read. `RosterCreated`
carries `roster`, `owner` and `creator` as indexed topics instead, so a reader filters to the
deployments it trusts. Nothing is stored that an attacker can grow.

**Deliberately not upgradeable.** The clones delegatecall a fixed implementation and no admin can swap it. R4 is that the contract is the single point of enforcement and therefore the single point of failure; an upgrade path adds a second way for the guarantee to fail — one an owner cannot audit by reading the code their agents are bound to.

Isolation now holds at two levels: between agents on one Roster (a storage-layout property, §4.4) and between teams (separate contracts, separate treasuries).

## 6. Backend endpoints

Owner-authenticated, except `POST /relay/spend`. Agents call only that one, carrying their own signature; everything else is owner-only.

| Endpoint | Purpose |
|---|---|
| `POST /agents` | Hire a new agent — full §4.1 flow. Answers `202` with a hire record; a background job runs the steps (DECISIONS.md 2026-09-11). |
| `GET /agents/hires` | Hires in flight, with the step each has reached; failed ones say whether anything reached the chain. |
| `DELETE /agents/hires/{id}` | Dismisses a finished hire. A hire still running can't be dismissed. |
| `GET /agents` | List every agent with role, budget status, last activity. |
| `GET /agents/{id}` | Single agent detail. |
| `PATCH /agents/{id}/caps` | Calls `updateCaps`. |
| `POST /agents/{id}/revoke` | Calls `revokeAgent`. §4.4 |
| `GET /agents/{id}/activity` | Per-agent feed, proxying Blockscout. §4.5 |
| `GET /pending` | All pending approval requests. |
| `POST /pending/{requestId}/approve` | Calls `approvePending`, then sends the Claude session event. §4.3 |
| `POST /pending/{requestId}/reject` | Calls `rejectPending`. |
| `POST /agents/{id}/fund` | One-off `fundAgent`. §4.6 |
| `POST /agents/{id}/defund` | Calls `defundAgent`. |
| `GET /treasury` | Earmarked, unallocated, and total balance. |
| `POST /treasury/withdraw` | Calls `withdrawTreasury`, always to the roster's owner. |
| `POST /agents/{id}/funding-schedule` | Recurring payroll top-up via Bridge Kit. §4.6 |
| `POST /relay/spend` | **Unauthenticated — the one route agents call.** Submits an agent's signed `executeSpendFor` and pays the gas with `RELAYER_PRIVATE_KEY`. The signature is the auth; the contract verifies it. Added 2026-09-11. |

**Not an endpoint but backend infrastructure:** a persistent listener on the contract's event stream watching for `PaymentPending`.

## 7. Implementation checkpoints

| # | Checkpoint | Notes |
|---|---|---|
| 1 | Deploy the Allowance Contract to Arc testnet | All functions in §5, with unit tests covering cap math and lazy period-reset. Contract and factory written and tested 2026-09-09; deployment pending an RPC URL and a funded key. |
| 2 | Verify Circle's Arc-testnet x402 facilitator end-to-end | Against one real service, before building anything on top of it. |
| 3 | Wire Privy wallet creation | Owner and agents; confirm an agent wallet can sign `executeSpend` and a real x402 header. |
| 4 | Create the Claude Managed Agents resources | One Agent config per role, one Environment, `managed-agents-2026-04-01` header. |
| 5 | Build the agent's payment tool | Reads a 402, calls `executeSpend`, signs and retries. |
| 6 | Build the backend endpoints in §6 | Wired to Privy, contract, Claude API. |
| 7 | Build the `PaymentPending` listener and the two-step approve action | §4.3 |
| 8 | Build the UI | Hire form, roster overview, pending-approval detail. Mocked data first. |
| 9 | Wire overview + activity feed to live Blockscout data | §4.5 |
| 10 | Wire Bridge Kit / Unified Balance | §4.6 |
| 11 | End-to-end rehearsal of the demo narrative | Run it twice from a clean state. |
| 12 | Wrap the allowance-check as a Bazantic recipe | Lowest priority. §4.7 |
| 13 | Record the demo video | — |

Checkpoint 2 is the one to front-load hardest.
