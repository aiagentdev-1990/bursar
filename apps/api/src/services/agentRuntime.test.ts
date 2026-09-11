import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { parseAgentPublicKey, AgentKeyNotProvided } from './agentRuntime.js'

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
