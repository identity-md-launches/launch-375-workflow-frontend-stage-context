import { encodeAbiParameters, keccak256, type Address, type Hex } from 'viem';
import { POOL } from '../config';

export interface PoolKey {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
}

const ZERO = '0x0000000000000000000000000000000000000000' as Address;

/**
 * Build the launch pool key: currency0 is the paired currency (native ETH), currency1 the token, with
 * the manifest's fee/tickSpacing and the deployed hook. Currencies are sorted ascending when the
 * paired currency is not native.
 */
export function buildPoolKey(token: Address, hook: Address): PoolKey {
  const paired = POOL.pairedCurrency.toLowerCase() as Address;
  const tok = token.toLowerCase() as Address;
  let currency0 = paired;
  let currency1 = tok;
  if (paired !== ZERO && BigInt(paired) > BigInt(tok)) {
    currency0 = tok;
    currency1 = paired;
  }
  return { currency0, currency1, fee: POOL.fee, tickSpacing: POOL.tickSpacing, hooks: hook.toLowerCase() as Address };
}

/** PoolId = keccak256(abi.encode(currency0, currency1, fee, tickSpacing, hooks)). */
export function poolIdOf(key: PoolKey): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: 'address' }, { type: 'address' }, { type: 'uint24' }, { type: 'int24' }, { type: 'address' }],
      [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks],
    ),
  );
}

export const Q96 = 2n ** 96n;
const WAD = 10n ** 18n;

/**
 * Price of currency1 per currency0 (token per ETH) as an 18-decimal fixed-point integer, assuming
 * both currencies use the same decimals (both are 18 here).
 */
export function tokenPerEthWad(sqrtPriceX96: bigint, decimals0 = 18, decimals1 = 18): bigint {
  const scale = 10n ** BigInt(18 + decimals0 - decimals1);
  return (sqrtPriceX96 * sqrtPriceX96 * scale) / (Q96 * Q96);
}

/** Inverse price (ETH per token) as an 18-decimal fixed-point integer; zero if the price is zero. */
export function ethPerTokenWad(tokenPerEth: bigint): bigint {
  if (tokenPerEth === 0n) return 0n;
  return (WAD * WAD) / tokenPerEth;
}

/** Amount of output implied at a given rate; used only for display. */
export function applySlippage(amountOut: bigint, slippagePercent: number): bigint {
  const bps = BigInt(Math.round(slippagePercent * 100));
  if (bps <= 0n) return amountOut;
  if (bps >= 10_000n) return 0n;
  return (amountOut * (10_000n - bps)) / 10_000n;
}
