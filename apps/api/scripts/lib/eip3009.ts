// USDC's EIP-3009 `transferWithAuthorization` — how the x402 "exact" scheme settles on Arc. The
// payer signs an authorization; someone else submits it and pays the gas. It is how an agent pays
// a seller without ever holding gas, the same property `executeSpendFor` gives the release.
//
// Scripts only. In production the seller's facilitator submits these; here the relayer plays
// that part.

import { randomBytes } from 'node:crypto'
import { parseSignature, toHex, type Address, type Hash, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { loadEnv } from '../../src/env.js'
import { publicClient, relayerAccount, relayerClient } from '../../src/chain/chain.js'

const abi = [
  { type: 'function', name: 'name', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'string' }] },
  { type: 'function', name: 'version', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'string' }] },
  {
    type: 'function',
    name: 'transferWithAuthorization',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
      { name: 'v', type: 'uint8' },
      { name: 'r', type: 'bytes32' },
      { name: 's', type: 'bytes32' },
    ],
    outputs: [],
  },
] as const

const TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const

let domain: { name: string; version: string; chainId: number; verifyingContract: Address } | undefined

/// Moves `value` from the payer to `to`. The payer only signs; the relayer submits.
export async function transferWithAuthorization(payerKey: Hex, to: Address, value: bigint): Promise<Hash> {
  const env = loadEnv()
  const relayer = relayerAccount
  const client = relayerClient
  if (!relayer || !client) throw new Error('RELAYER_PRIVATE_KEY is not set — it submits the authorization and pays the gas.')

  // Read from the token rather than hardcoded ("USDC", "2" on Arc today).
  domain ??= {
    name: await publicClient.readContract({ address: env.USDC_ADDRESS, abi, functionName: 'name' }),
    version: await publicClient.readContract({ address: env.USDC_ADDRESS, abi, functionName: 'version' }),
    chainId: env.ARC_CHAIN_ID,
    verifyingContract: env.USDC_ADDRESS,
  }

  const payer = privateKeyToAccount(payerKey)
  const message = {
    from: payer.address,
    to,
    value,
    validAfter: 0n,
    validBefore: BigInt(Math.floor(Date.now() / 1000) + 600),
    // EIP-3009 nonces are random, not sequential — each authorization is single-use by value.
    nonce: toHex(randomBytes(32)),
  }
  const signature = await payer.signTypedData({ domain, types: TYPES, primaryType: 'TransferWithAuthorization', message })
  const { r, s, v, yParity } = parseSignature(signature)

  const { request } = await publicClient.simulateContract({
    address: env.USDC_ADDRESS,
    abi,
    functionName: 'transferWithAuthorization',
    args: [message.from, message.to, message.value, message.validAfter, message.validBefore, message.nonce, Number(v ?? BigInt(yParity) + 27n), r, s],
    account: relayer,
  } as never)
  const hash = await client.writeContract(request as never)

  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error(`transferWithAuthorization reverted (${hash})`)
  return hash
}
