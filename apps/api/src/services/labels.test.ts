import { test } from 'node:test'
import assert from 'node:assert/strict'
import { encodeLabel, decodeLabel, InvalidLabelError } from './labels.js'

test('round-trips a name and role', () => {
  const label = { name: 'Pricer', role: 'Comparable-listing research' }
  assert.deepEqual(decodeLabel(encodeLabel(label)), label)
})

test('a role containing the delimiter survives, because only the first split counts', () => {
  const label = { name: 'Runner', role: 'Payouts | authentication' }
  assert.deepEqual(decodeLabel(encodeLabel(label)), label)
})

test('a name containing the delimiter is rejected rather than silently truncated', () => {
  assert.throws(() => encodeLabel({ name: 'Pri|cer', role: 'research' }), InvalidLabelError)
})

test('empty name or role is rejected', () => {
  assert.throws(() => encodeLabel({ name: '', role: 'research' }), InvalidLabelError)
  assert.throws(() => encodeLabel({ name: 'Pricer', role: '  ' }), InvalidLabelError)
})

test('trims surrounding whitespace', () => {
  assert.equal(encodeLabel({ name: '  Pricer  ', role: '  research ' }), 'Pricer|research')
})

test('a legacy role string with no delimiter keeps its whole value as the role', () => {
  assert.deepEqual(decodeLabel('Comparable-listing research'), {
    name: '',
    role: 'Comparable-listing research',
  })
})
