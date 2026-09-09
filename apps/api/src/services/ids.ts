import { keccak256, toBytes, type Address } from 'viem'

/// §4.1: the owner never sees a wallet address or an agent id. That constraint reaches the URL
/// bar too — a dashboard routing on `/agents/0xabc…` shows the owner an address whether or not
/// the page renders it.
///
/// So the API addresses agents by an opaque, stable handle derived from the wallet. Stable
/// because it is a pure function of the address (no registry to keep in sync), opaque because
/// the address cannot be read back out of it.
export function agentId(address: Address): string {
  return keccak256(toBytes(address.toLowerCase())).slice(2, 14)
}

export function findByAgentId(addresses: Address[], id: string): Address | undefined {
  return addresses.find((address) => agentId(address) === id)
}
