import { formatUnits, parseUnits } from 'viem';

/** Format a base-unit amount with grouping and a sensible number of fraction digits. */
export function formatAmount(value: bigint | undefined, decimals: number, maxFraction = 4): string {
  if (value === undefined) return '—';
  const raw = formatUnits(value, decimals);
  const [whole = '0', fraction = ''] = raw.split('.');
  const negative = whole.startsWith('-');
  const digits = negative ? whole.slice(1) : whole;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  let frac = fraction.slice(0, maxFraction).replace(/0+$/, '');
  if (frac.length === 0 && value !== 0n && digits === '0' && fraction.length > 0) {
    // Very small but nonzero: show the leading significant digits instead of "0".
    const m = fraction.match(/^(0*)([1-9]\d{0,2})/);
    if (m) frac = `${m[1]}${m[2]}`;
  }
  return `${negative ? '-' : ''}${grouped}${frac ? `.${frac}` : ''}`;
}

/** Parse a user-typed decimal amount; returns undefined for empty or invalid input. */
export function parseAmount(input: string, decimals: number): bigint | undefined {
  const trimmed = input.trim().replace(/,/g, '');
  if (trimmed === '' || trimmed === '.') return undefined;
  if (!/^\d*\.?\d*$/.test(trimmed)) return undefined;
  try {
    return parseUnits(trimmed, decimals);
  } catch {
    return undefined;
  }
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function shortHash(hash: string, head = 10, tail = 6): string {
  if (hash.length <= head + tail + 1) return hash;
  return `${hash.slice(0, head)}…${hash.slice(-tail)}`;
}

/** Human duration from a block count at an approximate block time. */
export function approxDuration(blocks: bigint, blockSeconds: number): string {
  const seconds = Number(blocks) * blockSeconds;
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 48) return rest ? `${hours} h ${rest} min` : `${hours} h`;
  const days = Math.floor(hours / 24);
  return `${days} d ${hours % 24} h`;
}

export function formatInteger(value: bigint | number | undefined): string {
  if (value === undefined) return '—';
  return value.toLocaleString('en-US');
}

/** Percent from a Uniswap fee in hundredths of a bip (3000 → 0.3). */
export function feePercent(fee: number): string {
  return `${(fee / 10_000).toString()}%`;
}
