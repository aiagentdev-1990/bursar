// ERC-8004 IdentityRegistry, Arc testnet.
//
// Hand-written rather than generated, because this contract is not ours — the entries below were
// read from the verified implementation (IdentityRegistryUpgradeable at
// 0x7274e874CA62410a93Bd8bf61c69d8045E399c02, behind the ERC-1967 proxy) and cover only what we
// call. The registry is an ERC-721: `register` mints an identity to msg.sender.

export const identityRegistryAbi = [
  {
    type: 'function',
    name: 'register',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'agentURI', type: 'string' }],
    outputs: [{ name: 'agentId', type: 'uint256' }],
  },
  {
    /// Binds a wallet to an identity. Called by the identity's owner; authorised by an EIP-712
    /// signature from the wallet itself, so the owner cannot attach an address that has not
    /// consented. The wallet only signs — it never sends a transaction, so it needs no gas.
    type: 'function',
    name: 'setAgentWallet',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'newWallet', type: 'address' },
      { name: 'deadline', type: 'uint256' },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'getAgentWallet',
    stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'ownerOf',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'tokenURI',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    /// `register` returns the id, but a state-changing call's return value is not available from
    /// a receipt — this event is where the id actually comes from.
    type: 'event',
    name: 'Registered',
    inputs: [
      { name: 'agentId', type: 'uint256', indexed: true },
      { name: 'agentURI', type: 'string', indexed: false },
      { name: 'owner', type: 'address', indexed: true },
    ],
  },
] as const

/// Verified live via `eip712Domain()` on the proxy.
export const IDENTITY_EIP712_NAME = 'ERC8004IdentityRegistry'
export const IDENTITY_EIP712_VERSION = '1'

/// From the verified source: AGENT_WALLET_SET_TYPEHASH.
export const AGENT_WALLET_SET_TYPES = {
  AgentWalletSet: [
    { name: 'agentId', type: 'uint256' },
    { name: 'newWallet', type: 'address' },
    { name: 'owner', type: 'address' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const

/// The contract requires `deadline <= block.timestamp + 5 minutes`. Stay well inside it.
export const AGENT_WALLET_DEADLINE_SECONDS = 240n
