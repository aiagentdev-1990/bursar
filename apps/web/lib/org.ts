import { MONTHS } from './roster'

/** Not on-chain and not in the API yet — the owner's organisation arrives with Privy auth
 *  (checkpoint 3). Kept as the mockups' name until then. */
export const ORG_NAME = 'Ellis Research'

/** `September 2026`. The contract's period is a fixed 30 days from each agent's hire
 *  (DECISIONS.md 2026-09-09); the calendar-month label is the mockups' framing of it. */
export function periodLabel(now = new Date()): string {
  return `${MONTHS[now.getMonth()]!} ${now.getFullYear()}`
}
