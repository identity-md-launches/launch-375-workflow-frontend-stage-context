/**
 * Runtime deployment configuration.
 *
 * Loads `imd-deployment.json` (written by `scripts/build-manifest.mjs` after every export) and the
 * ABI JSON files it references, validates the schema, re-verifies each ABI's canonical Keccak hash
 * against the attested `abiHash`, and exposes a typed `Deployment` the rest of the app consumes.
 */

import { defineChain, isAddress, keccak256, stringToHex, type Abi, type Address, type Chain, type Hex } from 'viem';
import { CONTRACT_NAMES, DEPLOYMENT_MANIFEST_PATH } from './config';

export interface ManifestContract {
  name: string;
  address: Address;
  abiHash: string;
  abiPath: string;
}

export interface ManifestAsset {
  path: string;
  sha256: string;
}

export interface NetworkBlock {
  chainId: number;
  name: string;
  testnet: boolean;
  rpcUrls: string[];
  explorer: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  faucets: string[];
  uniswapV4: {
    poolManager: Address;
    universalRouter: Address;
    quoter: Address;
    stateView: Address;
    positionManager: Address;
    permit2: Address;
  };
}

export interface DeploymentManifest {
  version: 1;
  launchId: string;
  chainId: number;
  sourceCommit: string;
  attestationHash: string;
  contracts: ManifestContract[];
  assets: ManifestAsset[];
  network: NetworkBlock;
}

export interface LoadedContract extends ManifestContract {
  abi: Abi;
}

export interface Deployment {
  manifest: DeploymentManifest;
  chain: Chain;
  network: NetworkBlock;
  token: LoadedContract;
  hook: LoadedContract;
  contracts: LoadedContract[];
  /** Exact `wallet_addEthereumChain` parameters derived from the network block. */
  walletAddChain: WalletAddChainParams;
}

export interface WalletAddChainParams {
  chainId: Hex;
  chainName: string;
  rpcUrls: string[];
  nativeCurrency: { name: string; symbol: string; decimals: number };
  blockExplorerUrls: string[];
}

export class DeploymentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeploymentError';
  }
}

const HEX64 = /^[0-9a-f]{64}$/;

/** Sort object keys recursively so the serialization is canonical. */
export function sortKeys<T>(value: T): T {
  if (Array.isArray(value)) return value.map(sortKeys) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out as T;
  }
  return value;
}

/** Canonical Keccak-256 of an ABI: keccak256(JSON with sorted keys and no whitespace), hex without 0x. */
export function canonicalAbiHash(abi: unknown): string {
  return keccak256(stringToHex(JSON.stringify(sortKeys(abi)))).slice(2);
}

/** A manifest-relative path must stay inside dist/: no URL scheme, no absolute path, no parent traversal. */
export function isSafeRelativePath(path: string): boolean {
  if (typeof path !== 'string' || path.length === 0) return false;
  if (path.startsWith('/') || path.startsWith('\\')) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return false;
  const segments = path.split(/[\\/]/);
  return segments.every((s) => s !== '' && s !== '.' && s !== '..');
}

function fail(message: string): never {
  throw new DeploymentError(message);
}

/** Validate the raw manifest object against the required schema. */
export function validateManifest(raw: unknown): DeploymentManifest {
  if (!raw || typeof raw !== 'object') fail('Deployment manifest is not an object.');
  const m = raw as Record<string, unknown>;
  if (m.version !== 1) fail('Deployment manifest version must be 1.');
  if (typeof m.launchId !== 'string' || m.launchId.length === 0) fail('Deployment manifest is missing launchId.');
  if (typeof m.chainId !== 'number' || !Number.isInteger(m.chainId) || m.chainId <= 0) fail('Deployment manifest chainId is invalid.');
  if (typeof m.sourceCommit !== 'string' || !/^[0-9a-f]{40}$/.test(m.sourceCommit)) fail('Deployment manifest sourceCommit is invalid.');
  if (typeof m.attestationHash !== 'string' || !HEX64.test(m.attestationHash)) fail('Deployment manifest attestationHash is invalid.');
  if (!Array.isArray(m.contracts) || m.contracts.length === 0) fail('Deployment manifest has no contracts.');
  for (const c of m.contracts as Record<string, unknown>[]) {
    if (typeof c.name !== 'string' || c.name.length === 0) fail('A manifest contract has no name.');
    if (typeof c.address !== 'string' || !isAddress(c.address, { strict: false })) fail(`Contract ${c.name} has an invalid address.`);
    if (typeof c.abiHash !== 'string' || !HEX64.test(c.abiHash)) fail(`Contract ${c.name} has an invalid abiHash.`);
    if (typeof c.abiPath !== 'string' || !isSafeRelativePath(c.abiPath)) fail(`Contract ${c.name} has an unsafe abiPath.`);
  }
  if (!Array.isArray(m.assets)) fail('Deployment manifest has no assets list.');
  for (const a of m.assets as Record<string, unknown>[]) {
    if (typeof a.path !== 'string' || !isSafeRelativePath(a.path)) fail('A manifest asset has an unsafe path.');
    if (typeof a.sha256 !== 'string' || !HEX64.test(a.sha256)) fail(`Asset ${a.path} has an invalid sha256.`);
  }
  const n = m.network as Record<string, unknown> | undefined;
  if (!n || typeof n !== 'object') fail('Deployment manifest has no network block.');
  if (n.chainId !== m.chainId) fail('Network block chainId does not match the manifest chainId.');
  if (typeof n.name !== 'string') fail('Network block has no name.');
  if (!Array.isArray(n.rpcUrls) || n.rpcUrls.length === 0 || !n.rpcUrls.every((u) => typeof u === 'string' && /^https:\/\//.test(u))) {
    fail('Network block needs at least one public https RPC URL.');
  }
  if (typeof n.explorer !== 'string') fail('Network block has no explorer.');
  const nc = n.nativeCurrency as Record<string, unknown> | undefined;
  if (!nc || typeof nc.name !== 'string' || typeof nc.symbol !== 'string' || typeof nc.decimals !== 'number') fail('Network block nativeCurrency is invalid.');
  const u = n.uniswapV4 as Record<string, unknown> | undefined;
  if (!u) fail('Network block has no uniswapV4 addresses.');
  for (const key of ['poolManager', 'universalRouter', 'quoter', 'stateView', 'positionManager', 'permit2'] as const) {
    if (typeof u[key] !== 'string' || !isAddress(u[key] as string, { strict: false })) fail(`Network block uniswapV4.${key} is invalid.`);
  }
  return raw as DeploymentManifest;
}

/** Build the exact `wallet_addEthereumChain` request parameters from the network block. */
export function walletAddChainParams(network: NetworkBlock): WalletAddChainParams {
  return {
    chainId: `0x${network.chainId.toString(16)}`,
    chainName: network.name,
    rpcUrls: [...network.rpcUrls],
    nativeCurrency: { ...network.nativeCurrency },
    blockExplorerUrls: [network.explorer],
  };
}

/** Build the viem/wagmi chain definition from the network block. */
export function chainFromNetwork(network: NetworkBlock): Chain {
  return defineChain({
    id: network.chainId,
    name: network.name,
    testnet: network.testnet,
    nativeCurrency: { ...network.nativeCurrency },
    rpcUrls: { default: { http: [...network.rpcUrls] } },
    blockExplorers: { default: { name: 'Explorer', url: network.explorer } },
  });
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { cache: 'no-cache' });
  if (!response.ok) fail(`Unable to load ${url} (HTTP ${response.status}).`);
  return response.json();
}

/**
 * Load and verify the deployment manifest and its ABIs relative to `baseUrl` (the document base).
 * Throws `DeploymentError` on any schema, path or hash problem, so the app never enables
 * transactions against configuration that disagrees with the attested handoff.
 */
export async function loadDeployment(baseUrl: string = document.baseURI): Promise<Deployment> {
  const manifestUrl = new URL(DEPLOYMENT_MANIFEST_PATH, baseUrl).toString();
  const manifest = validateManifest(await fetchJson(manifestUrl));

  const contracts: LoadedContract[] = [];
  for (const c of manifest.contracts) {
    const abi = await fetchJson(new URL(`./${c.abiPath}`, baseUrl).toString());
    if (!Array.isArray(abi)) fail(`ABI at ${c.abiPath} is not a JSON array.`);
    const hash = canonicalAbiHash(abi);
    if (hash !== c.abiHash) fail(`ABI hash mismatch for ${c.name}: manifest ${c.abiHash}, loaded ${hash}.`);
    contracts.push({ ...c, address: c.address.toLowerCase() as Address, abi: abi as Abi });
  }

  const token = contracts.find((c) => c.name === CONTRACT_NAMES.token);
  const hook = contracts.find((c) => c.name === CONTRACT_NAMES.hook);
  if (!token) fail(`Manifest has no ${CONTRACT_NAMES.token} contract.`);
  if (!hook) fail(`Manifest has no ${CONTRACT_NAMES.hook} contract.`);

  const network = manifest.network;
  return {
    manifest,
    chain: chainFromNetwork(network),
    network,
    token,
    hook,
    contracts,
    walletAddChain: walletAddChainParams(network),
  };
}
