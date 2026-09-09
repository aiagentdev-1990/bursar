/// The contract has one `role` string and no `name` field, but the hire form collects Name and
/// Role separately (docs/mockups/README.md §3). Two ways to close that gap: a backend datastore
/// keyed by agent address, or carry both in the one on-chain string.
///
/// This carries both, because the alternative breaks a settled decision. DECISIONS.md 2026-09-08
/// says the dashboard reads Blockscout with no indexer to build; a name table would be a second
/// source of truth that can drift from chain state and has to be restored alongside it. The
/// `role` field is documented as "dashboard label only — no enforcement depends on it", so a
/// structured display string is a legitimate use of it, and `AgentRegistered` carries it into
/// the event log for free.
///
/// If you would rather have the datastore, this module is the only thing that has to change.

const DELIMITER = '|'

export interface AgentLabel {
  name: string
  role: string
}

export class InvalidLabelError extends Error {}

/// `{ name: 'Pricer', role: 'Comparable-listing research' }` → `'Pricer|Comparable-listing research'`
export function encodeLabel(label: AgentLabel): string {
  const name = label.name.trim()
  const role = label.role.trim()

  if (!name) throw new InvalidLabelError('Name is required.')
  if (!role) throw new InvalidLabelError('Role is required.')
  if (name.includes(DELIMITER)) {
    throw new InvalidLabelError(`Name cannot contain "${DELIMITER}".`)
  }

  return `${name}${DELIMITER}${role}`
}

/// Splits on the first delimiter only, so a role containing one round-trips intact.
/// A string written before this convention (or by a direct contract call) has no delimiter —
/// treat the whole thing as the role rather than losing it.
export function decodeLabel(encoded: string): AgentLabel {
  const at = encoded.indexOf(DELIMITER)
  if (at === -1) return { name: '', role: encoded }

  return {
    name: encoded.slice(0, at),
    role: encoded.slice(at + 1),
  }
}
