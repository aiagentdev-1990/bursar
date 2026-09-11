/// The EIP-712 struct an agent signs for `executeSpendFor`. Must match `SPEND_TYPEHASH` in
/// Roster.sol field for field; the domain is read from the contract's own `eip712Domain()` rather
/// than restated here.
///
/// Its own module, with no imports, on purpose: anything that imports chain.ts loads the
/// environment at import time, and a test that needs only this constant must not trigger that
/// before the harness has set its environment.
export const SPEND_TYPES = {
  Spend: [
    { name: 'agent', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'payee', type: 'address' },
    { name: 'memo', type: 'bytes' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const
