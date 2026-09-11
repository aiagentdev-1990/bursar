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
 * Secondary position only — round cap figures that the mockups render bare: `$400 cap`,
 * `of $2,250 committed`, `UNSPENT $724`. Never use this for a transaction amount.
 *
 * Bare only when the figure really is whole dollars; anything with cents falls back to `usd`.
 * Live caps are set by the owner, not the mockups — a $1.50 cap rendered as "$2 cap" would
 * misstate the limit the contract is actually enforcing.
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

/** Budget-bar fill, 0–100. Clamped: a bar never renders past full. */
export function pctOfCap(spent: bigint, cap: bigint): number {
  if (cap <= 0n) return 0
  const raw = Number((spent * 10000n) / cap) / 100
  return Math.max(0, Math.min(100, raw))
}
