// USDC is 6 decimals. Every amount in this app is a bigint in base units, exactly as the
// contract stores it (CLAUDE.md: "Never use floats for money anywhere in the stack — parse and
// format at the UI edge only"). This file is that edge, and the only one.

export const USDC_DECIMALS = 6
const SCALE = 10n ** BigInt(USDC_DECIMALS)

function group(whole: bigint): string {
  return whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** Primary money display: always two decimals with a `$` prefix. `$1,526.00` */
export function usd(base: bigint): string {
  const neg = base < 0n
  const abs = neg ? -base : base
  const whole = abs / SCALE
  const frac = abs % SCALE
  // Round to 2dp rather than truncate, so a display never understates a charge.
  const centsExact = frac * 100n
  let cents = centsExact / SCALE
  if (centsExact % SCALE >= SCALE / 2n) cents += 1n
  const carry = cents / 100n
  cents = cents % 100n
  return `${neg ? '-' : ''}$${group(whole + carry)}.${cents.toString().padStart(2, '0')}`
}

/**
 * Transaction amounts in the activity log, where rounding to cents is lossy: agents pay for
 * single API calls, and `usd` renders a $0.006 crawl as "$0.01" and a $0.0004 call as "$0.00" —
 * a payment that reads as nothing at all.
 *
 * Always at least two decimals so the column still scans as money, then as many more as the
 * amount actually carries, up to USDC's six. Trailing zeros past the second are dropped, so
 * whole cents are unchanged: `$1.20`, `$0.006`, `$0.000432`.
 */
export function usdExact(base: bigint): string {
  const neg = base < 0n
  const abs = neg ? -base : base
  const frac = (abs % SCALE).toString().padStart(USDC_DECIMALS, '0')
  const shown = frac.replace(/0+$/, '').padEnd(2, '0')
  return `${neg ? '-' : ''}$${group(abs / SCALE)}.${shown}`
}

/**
 * Secondary position only — round limit figures that the mockups render bare: `of $400`,
 * `up to $50 per purchase`. Never use this for a transaction amount.
 *
 * Bare only when the figure really is whole dollars; anything with cents falls back to `usd`.
 * Live limits are set by the owner, not the mockups — a $1.50 limit rendered as "$2" would
 * misstate what the contract is actually enforcing.
 */
export function usdWhole(base: bigint): string {
  if (base % SCALE !== 0n) return usd(base)
  const neg = base < 0n
  const abs = neg ? -base : base
  let whole = abs / SCALE
  if (abs % SCALE >= SCALE / 2n) whole += 1n
  return `${neg ? '-' : ''}$${group(whole)}`
}

/** Bare number typed into the hire form (`75`, `400`, `12.50`) → base units. */
export function parseUsd(input: string): bigint | null {
  const trimmed = input.trim().replace(/[$,]/g, '')
  if (trimmed === '' || !/^\d*(\.\d*)?$/.test(trimmed)) return null
  const [whole = '0', frac = ''] = trimmed.split('.')
  if (frac.length > USDC_DECIMALS) return null
  return BigInt(whole || '0') * SCALE + BigInt(frac.padEnd(USDC_DECIMALS, '0') || '0')
}

/** Monthly-limit bar fill, 0–100. Clamped: a bar never renders past full. */
export function pctOfCap(spent: bigint, cap: bigint): number {
  if (cap <= 0n) return 0
  const raw = Number((spent * 10000n) / cap) / 100
  return Math.max(0, Math.min(100, raw))
}
