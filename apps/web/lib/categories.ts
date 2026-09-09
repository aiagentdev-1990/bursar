// DECISIONS.md 2026-09-09 (discrepancy 5): the contract carries one `role` string and nothing
// more. The hire form has no category input — it is four fields by design — so the agent-level
// CATEGORY column is derived from the role text here, in the UI, by keyword.
//
// This is presentation only. No enforcement anywhere reads it.

export const CATEGORIES = [
  'Data & research',
  'Messaging',
  'Contract work',
  'Sourcing',
  'Finance & admin',
] as const

export type Category = (typeof CATEGORIES)[number]

const RULES: ReadonlyArray<readonly [RegExp, Category]> = [
  [/research|pricing|comparable|listing|market|data|analy/i, 'Data & research'],
  [/support|buyer|question|message|messaging|sms|email|chat|concierge/i, 'Messaging'],
  [/payout|contract|task|authenticat|fulfil|logistic|courier|deliver/i, 'Contract work'],
  [/sourc|auction|estate|scout|lead|discover/i, 'Sourcing'],
  [/book|ledger|reconcil|invoice|account|tax|admin|finance/i, 'Finance & admin'],
]

/** Best-effort category for a role string. Falls back to the broadest bucket. */
export function categoryForRole(role: string): Category {
  for (const [pattern, category] of RULES) {
    if (pattern.test(role)) return category
  }
  return 'Data & research'
}
