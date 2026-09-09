import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import type { Address } from 'viem'
import { loadEnv } from '../env.js'
import { ApiError } from '../http/errors.js'
import { store } from './store.js'

/// §4.1: the owner never handles a private key and never sees an address. The backend asks a
/// provider for a wallet and passes the address straight to `hireAgent`; it is never shown to
/// the owner and never returned by the API.

export interface WalletProvider {
  readonly kind: 'privy' | 'local'
  createAgentWallet(label: string): Promise<Address>
}

/// Checkpoint 3. Deliberately not written speculatively — the Privy server API surface has not
/// been verified against a real app id yet, and a plausible-looking wrong integration is worse
/// than an explicit gap: it fails at demo time instead of at boot.
class PrivyWalletProvider implements WalletProvider {
  readonly kind = 'privy' as const

  async createAgentWallet(): Promise<Address> {
    throw new ApiError(
      501,
      'privy_not_wired',
      'Privy wallet provisioning is checkpoint 3 and is not wired yet. Set WALLET_PROVIDER=local for now.',
    )
  }
}

/// Development only. Generates a keypair in-process and persists it beside the service so the
/// agent's payment tool can sign with it. This is exactly the "manual key handling" §4.1 exists
/// to remove — it is a scaffold for testing the contract path before Privy lands, and env.ts
/// refuses to start with it when NODE_ENV=production.
class LocalWalletProvider implements WalletProvider {
  readonly kind = 'local' as const

  async createAgentWallet(label: string): Promise<Address> {
    const privateKey = generatePrivateKey()
    const address = privateKeyToAccount(privateKey).address

    store.setLocalKey(address, privateKey)
    console.warn(`[roster-api] generated a LOCAL dev key for "${label}" (${address}). Not for production.`)

    return address
  }
}

export function walletProvider(): WalletProvider {
  return loadEnv().WALLET_PROVIDER === 'privy' ? new PrivyWalletProvider() : new LocalWalletProvider()
}
