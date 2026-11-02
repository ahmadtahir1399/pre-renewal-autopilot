// Locale-independent formatting for fixture documents and answer keys.
// Hand-written (no toLocaleString) so output never depends on the ICU build.

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** 12400 -> 'NZD 12,400.00' (decimals = 2) or 'NZD 12,400' (decimals = 0). */
export function formatNzd(amount: number, decimals: 0 | 2): string {
  const sign = amount < 0 ? '-' : '';
  const cents = Math.round(Math.abs(amount) * 100);
  const whole = groupThousands(String(Math.floor(cents / 100)));
  const fraction = String(cents % 100).padStart(2, '0');
  return `${sign}NZD ${decimals === 2 ? `${whole}.${fraction}` : whole}`;
}

/** Signed money change: +NZD 744.00 / -NZD 555.00. */
export function formatNzdChange(delta: number, decimals: 0 | 2): string {
  const body = formatNzd(Math.abs(delta), decimals);
  return `${delta < 0 ? '-' : '+'}${body}`;
}

/** Signed percentage with one decimal: +6.0% / -50.0%. */
export function formatPercentChange(percent: number): string {
  const rounded = Math.round(Math.abs(percent) * 10) / 10;
  return `${percent < 0 ? '-' : '+'}${rounded.toFixed(1)}%`;
}

/** Percentage change from a to b (unrounded). */
export function percentChange(from: number, to: number): number {
  return ((to - from) / from) * 100;
}
