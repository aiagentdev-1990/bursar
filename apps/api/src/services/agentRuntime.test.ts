import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'
import { parseAgentPublicKey, AgentKeyNotProvided, parseWalletAddress, AgentSetupFailed } from './agentRuntime.js'

/// A real P-256 SPKI public key, so the test asserts against the actual format rather than a
/// string that merely looks like one.
function realKey(): string {
  const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  return publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
}

test('accepts the marked line', () => {
  const key = realKey()
  assert.equal(parseAgentPublicKey(`Done.\nAGENT_PUBLIC_KEY: ${key}\nReady.`), key)
})

test('finds a bare key when the agent forgets the marker', () => {
  const key = realKey()
  assert.equal(parseAgentPublicKey(`Here it is: ${key}`), key)
})

test('rejects a reply with no key at all', () => {
  assert.throws(() => parseAgentPublicKey('Sure, I will do that shortly.'), AgentKeyNotProvided)
})

test('rejects something key-shaped that is not a P-256 SPKI key', () => {
  const notAKey = Buffer.alloc(91, 7).toString('base64')
  assert.throws(() => parseAgentPublicKey(`AGENT_PUBLIC_KEY: ${notAKey}`), AgentKeyNotProvided)
})

test('rejects a truncated key of the right shape', () => {
  const key = realKey()
  assert.throws(
    () => parseAgentPublicKey(`AGENT_PUBLIC_KEY: ${key.slice(0, 100)}`),
    AgentKeyNotProvided,
  )
})

// ─── the wallet address the x402-arc skill reports ──────────────────────────

const realAddress = () => privateKeyToAccount(generatePrivateKey()).address

test('reads the WALLET_ADDRESS line out of a chatty reply, checksummed', () => {
  const address = realAddress()
  const reply = `Setup done.\n\nWALLET_ADDRESS: ${address.toLowerCase()}\n\nWaiting to be told I'm on the roster.`
  assert.equal(parseWalletAddress(reply), address)
})

test('accepts the same address repeated', () => {
  const address = realAddress()
  assert.equal(parseWalletAddress(`WALLET_ADDRESS: ${address}\n…\nWALLET_ADDRESS: ${address}`), address)
})

test('rejects a reply with no wallet line — the address is never guessed from prose', () => {
  assert.throws(() => parseWalletAddress(`My wallet is ${realAddress()}.`), AgentSetupFailed)
})

test('rejects two different addresses: which one to fund is ambiguous', () => {
  assert.throws(
    () => parseWalletAddress(`WALLET_ADDRESS: ${realAddress()}\nWALLET_ADDRESS: ${realAddress()}`),
    AgentSetupFailed,
  )
})

test('rejects a mixed-case address with a bad checksum — a retyped address with a typo', () => {
  // An address with at least one uppercase and two lowercase hex letters: flipping the first
  // lowercase one leaves it mixed-case, so the checksum applies, and wrong.
  let address = realAddress()
  while (!/[A-F]/.test(address.slice(2)) || (address.slice(2).match(/[a-f]/g) ?? []).length < 2) address = realAddress()
  const bad = `0x${address.slice(2).replace(/[a-f]/, (c) => c.toUpperCase())}`

  assert.throws(() => parseWalletAddress(`WALLET_ADDRESS: ${bad}`), AgentSetupFailed)
})
