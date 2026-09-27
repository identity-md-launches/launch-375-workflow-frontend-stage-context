/**
 * Central frontend configuration.
 *
 * Everything chain-specific (chain id, contract addresses, ABIs, public RPC URLs, explorer and the
 * Uniswap v4 periphery addresses) is NOT defined here. It is read at runtime from the deployment
 * manifest `imd-deployment.json` that the build writes next to `index.html` (see
 * `scripts/build-manifest.mjs` and `src/deployment.ts`). Keeping one runtime source prevents a
 * hand-maintained address table from drifting away from the attested handoff.
 *
 * This file holds only the values that are not part of that manifest schema: the launch's pool
 * parameters (copied from the attested launch manifest `handoff/deployment.json` → `manifest.pool`
 * and `manifest.token`), swap defaults, and polling intervals. No private credentials exist anywhere
 * in the frontend; every RPC URL comes from the manifest's public `network.rpcUrls` list.
 */

import type { Address } from 'viem';

/** Path of the runtime deployment manifest, relative to `index.html`. */
export const DEPLOYMENT_MANIFEST_PATH = './imd-deployment.json';

/** Contract names exactly as they appear in the deployment handoff. */
export const CONTRACT_NAMES = {
  token: 'MAXT',
  hook: 'MaxTxHook',
} as const;

/**
 * Pool parameters of the launch pool, from the attested launch manifest (`manifest.pool`).
 * `currency0` is the paired currency (native ETH = zero address) and `currency1` is the token; the
 * deployed addresses themselves come from the runtime manifest.
 */
export const POOL = {
  pairedCurrency: '0x0000000000000000000000000000000000000000' as Address,
  fee: 3000,
  tickSpacing: 60,
} as const;

/** Token metadata from the launch manifest, used as a fallback until the chain answers. */
export const TOKEN_META = {
  name: 'Maxtx',
  symbol: 'MAXT',
  decimals: 18,
} as const;

/** Swap defaults. */
export const SWAP = {
  /** Default slippage tolerance in percent applied to the quoted output. */
  defaultSlippagePercent: 0.5,
  /** Maximum slippage the form accepts, in percent. */
  maxSlippagePercent: 50,
  /** Transaction deadline offset in seconds (20 minutes). */
  deadlineSeconds: 20 * 60,
  /** Permit2 allowance expiration offset in seconds (30 days). */
  permit2ExpirationSeconds: 30 * 24 * 60 * 60,
  /** Debounce applied to quote requests while typing, in milliseconds. */
  quoteDebounceMs: 400,
} as const;

/** Polling and event-lookup settings for public RPC reads. */
export const READS = {
  /** How often to poll the chain for new blocks and state, in milliseconds. */
  pollingIntervalMs: 12_000,
  /** Fallback lookback (in blocks) for event queries when the RPC rejects a full-history query. */
  eventLookbackBlocks: 20_000n,
  /** Approximate Sepolia block time in seconds, used only for the human time estimate. */
  approxBlockSeconds: 12,
  /** Maximum number of recent swaps rendered in the activity list. */
  maxSwapsShown: 12,
} as const;

/**
 * Optional WalletConnect project id. Not supplied for this deployment: the app ships browser-wallet
 * (EIP-1193 / EIP-6963) connectors only. See web/README.md for how to add WalletConnect.
 */
export const WALLETCONNECT_PROJECT_ID: string | undefined = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID;
