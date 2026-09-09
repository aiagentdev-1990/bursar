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

Hiring provisions four things: a **wallet** (Privy), an **on-chain identity** (ERC-8004), an
**allowance** (the Allowance Contract), and a **running instance** (Claude Managed Agents —
Agent config, Environment, optional Vault, Session).

#### What lives where, and why

Each system owns exactly one thing, and nothing is stored twice.

| Fact | Home | Why there |
|---|---|---|
| Both caps, period spend, period start, active flag | **Allowance Contract** | Enforcement. Nothing else may hold these. |
| Earmarked balance, treasury | **Allowance Contract** | It is the treasury. |
| Agent **name** and **role** | **ERC-8004 metadata** | Display and discovery. Neither is read by any enforcement path. |
| Identity ↔ wallet binding | **ERC-8004** (`getAgentWallet`) | That is precisely what the registry is for. |
| `agentId` | **Nowhere, twice** | Derivable from the registry's own `Registered` / `MetadataSet` events. The backend caches it; the cache is disposable. |
| Claude `session_id` | **Backend store** | Not derivable from any chain. |

**What this offloads from the Allowance Contract.** `AgentInfo.role` was always a passenger — the
interface itself called it "dashboard label only — no enforcement depends on it". It was there
because the dashboard needed a label and there was nowhere else to put it. ERC-8004 metadata *is*
that somewhere else, and it is the place other tools already look. Removing it means:

- `hireAgent(address agent, uint256 perTxCap, uint256 perPeriodCap)` — no string argument, so a
  hire stops paying for a dynamic-length SSTORE in the enforcement contract.
- `AgentInfo` loses its only non-enforcement field. Everything left in that struct is load-bearing.
- The `"Name|Role"` delimiter hack disappears, and with it `apps/api/src/services/labels.ts`.
  That hack existed only because the contract had one string and the form collected two fields.
  It was a compromise recorded as such; ERC-8004 removes the need for it rather than tidying it.

**The cost, stated plainly.** This makes ERC-8004 *required* for a complete hire rather than a
nice-to-have badge. An agent whose identity registration fails has no name to render. Two extra
transactions per hire. And the registry is an external, upgradeable contract we do not control.
That is the trade being made: one less field in the contract that matters most, in exchange for a
dependency in the flow that matters least.

#### The order, and why it is that order

The invariant is: **an agent that can spend always has enforced caps.** `hireAgent` is what brings
an agent into existence, so nothing that moves money may precede it, and funding must follow it.

Identity is provisioned *before* `hireAgent` because its output (the name and role) is part of what
makes a hire complete, and because failing early is clean: a registration that succeeds while
`hireAgent` fails leaves an identity NFT bound to a wallet that is on no roster, holds nothing, and
cannot spend — harmless, and reusable on retry.

```mermaid
sequenceDiagram
    autonumber
    actor Owner
    participant Backend as Roster Backend
    participant Privy
    participant Wallet as Agent wallet<br/>(signs only — never funded with gas)
    participant Registry as ERC-8004<br/>IdentityRegistry
    participant Contract as Allowance Contract (Arc)
    participant Claude as Claude Managed Agents

    Owner->>Backend: Hire agent (name, role, perTxCap, perPeriodCap)

    Backend->>Privy: Create embedded wallet
    Privy-->>Backend: Agent wallet address

    rect rgb(24, 34, 30)
        Note over Backend,Registry: Identity. Fails clean — no agent exists yet.
        Backend->>Registry: register(agentURI) — name + role, as the owner
        Registry-->>Backend: Registered(agentId, agentURI, owner)
        Backend->>Wallet: Sign EIP-712 AgentWalletSet<br/>(agentId, newWallet, owner, deadline)
        Wallet-->>Backend: signature — no transaction, no gas
        Backend->>Registry: setAgentWallet(agentId, wallet, deadline, signature)
        Registry-->>Backend: getAgentWallet(agentId) → the agent's wallet
    end

    rect rgb(28, 32, 46)
        Note over Backend,Contract: The agent comes into existence here, already capped.
        Backend->>Contract: hireAgent(wallet, perTxCap, perPeriodCap)
        Contract-->>Backend: AgentRegistered — caps enforced from this block
        opt opening earmark requested
            Backend->>Contract: fundAgent(wallet, amount)
        end
    end

    rect rgb(34, 30, 24)
        Note over Backend,Claude: Best effort. A hire that cannot start is still a capped agent.
        alt this role's Agent config doesn't exist yet
            Backend->>Claude: POST /v1/agents (model, system, tools)
            Claude-->>Backend: agent_id — versioned, reused by every future hire of this role
        end
        Backend->>Claude: POST /v1/sessions (agent_id, environment_id)
        Claude-->>Backend: session_id — provisioned, idle
        Backend->>Claude: POST /v1/sessions/{id}/events — "start working"
    end

    Backend-->>Owner: Agent hired, capped, and running
```

#### Why the owner holds the identity, and the agent only signs

`register` mints to `msg.sender`, and `setAgentWallet` requires `msg.sender == ownerOf(agentId)`.
If the agent owned its own identity it would have to send both transactions itself — which means
funding a brand-new wallet with gas before it has done anything, on a chain where gas is USDC.

So the owner holds the NFT and the agent's wallet is *bound* to it. The agent signs one EIP-712
message and never sends a transaction. `getAgentWallet(agentId)` resolves the identity to the
spending address, which is what an outside verifier actually wants to know. It also matches the
product: the owner hires and fires, so the owner holds the credential.

The signed struct is `AgentWalletSet(uint256 agentId,address newWallet,address owner,uint256
deadline)` under domain `{name: "ERC8004IdentityRegistry", version: "1", chainId: 5042002,
verifyingContract: <registry>}`. The registry accepts an ECDSA signature or an ERC-1271 one, so a
Privy smart wallet works as well as an EOA. `deadline` must be within five minutes.

#### ERC-8004 does not gate spending

`onlyAgent` stays a plain-address check. Resolving identity through the registry inside
`executeSpend` would put an external, upgradeable contract in the enforcement path — a second way
for the guarantee to fail, inside the thing that *is* the guarantee (risk R4). Identity is
provenance, not authorization.

This settles open question 2, and it settles it as "both": the allowance binds to a plain address,
and the agent additionally has an ERC-8004 identity that resolves to that address. Neither depends
on the other at execution time.

**Why Agent and Environment are separate from Session:** Agent and Environment are versioned, reusable resources — a "Pricing research agent" role only needs to be defined once, then every hire of that role reuses the same `agent_id`. A Session is the actual running instance tied to one specific hire: one wallet, one allowance, one vault credential.

**Two distinct caps, not one:** the `budget` object at session creation caps Claude's own token/compute spend for that session. This is separate from the Allowance Contract's per-transaction and per-period USDC caps — one bounds what the agent costs to run, the other bounds what it's allowed to pay out.

**Creating a session doesn't start work.** The backend still has to send a user event (or pass `initial_events`) to kick the agent into motion.

The owner never sees a wallet address or an agent ID. `hireAgent` is `onlyOwner`; the caller's identity is checked against the roster's owner, not against the new agent.

#### Addresses (Arc testnet), verified on-chain

| What | Address |
|---|---|
| IdentityRegistry (ERC-1967 proxy) | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| └ implementation `IdentityRegistryUpgradeable` | `0x7274e874CA62410a93Bd8bf61c69d8045E399c02` |
| ReputationRegistry | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |
| ValidationRegistry | `0x8004Cb1BF31DAf7788923b405b754f57acEB4272` |

Only the IdentityRegistry is used. Reputation and Validation are out of scope — Roster does not
score an agent's output quality (PRD §9 excludes it explicitly).

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

0. **Awaiting a decision:** move agent name and role out of the Allowance Contract into ERC-8004
   metadata, per §4.1's "what lives where". It removes the only non-enforcement field from
   `AgentInfo`, removes the `"Name|Role"` delimiter hack, and shortens `hireAgent` — at the cost of
   making ERC-8004 a required step in the hire flow rather than an optional badge. §4.1 is written
   as though this is settled; §5 still lists the shipped signature. One of the two has to change.
1. Does Circle's Agent Stack expose a testnet-ready SDK on Arc, or does §4.2's facilitator interaction need to be built against the raw x402 spec directly? *(Answered 2026-09-09: yes — `@circle-fin/x402-batching` v2 with `GatewayClient` / `BatchFacilitatorClient`. See the Gateway custody conflict noted against §4.2.)*
2. Does `executeSpend`'s `onlyAgent` check bind to a plain contract address, or does agent identity need to resolve through ERC-8004? *(Implemented as a plain address; ERC-8004 is on the backlog's cut list and nothing in the contract assumes either answer.)*

## 5. Smart contract functions

| Function signature | Access control | Purpose |
|---|---|---|
| `hireAgent(address agent, uint256 perTxCap, uint256 perPeriodCap, string calldata role)` | `onlyOwner` | Registers a new agent's wallet address, its two caps, and its role label. §4.1 |
| ↳ **proposed:** `hireAgent(address agent, uint256 perTxCap, uint256 perPeriodCap)` | `onlyOwner` | Drops `role` once ERC-8004 metadata owns the name and role (§4.1). **Not yet implemented** — the shipped contract still takes the string. |
| `initialize(address owner)` | Once, by the factory | Sets the owner. Replaces a constructor, which a minimal proxy cannot run. |
| `fundAgent(address agent, uint256 amount)` | `onlyOwner` | Earmarks USDC the Roster **already holds** for that agent. Moves no tokens. Reverts if the balance can't cover every earmark. §4.6 |
| `executeSpend(uint256 amount, address payee, bytes calldata memo) returns (bool executed, uint256 requestId)` | `onlyAgent` | Checks both caps. If satisfied, transfers `amount` to the agent's own wallet and returns `executed = true`. If not, opens a pending request. §4.2, §4.3 |
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

Owner-authenticated only. Agents never call these; an agent's payment tool talks to the contract and the x402 facilitator directly with its own wallet.

| Endpoint | Purpose |
|---|---|
| `POST /agents` | Hire a new agent — full §4.1 flow. |
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
