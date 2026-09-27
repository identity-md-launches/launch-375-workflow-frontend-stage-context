#!/usr/bin/env node
/**
 * Emit dist/imd-deployment.json after the static export.
 *
 * - Copies identifiers, chain, source commit, attestation hash and the exact contract set from the
 *   validated deployment handoff (default: web/handoff/deployment.json).
 * - Copies each implementation-derived ABI from docs/abi/<Contract>.json (pinned source commit) into
 *   dist/abi/<Contract>.json as a raw JSON array and verifies canonicalKeccak(abi) == abiHash.
 * - Copies the `network` block from the network handoff (default: web/handoff/network.json) unchanged.
 * - Records the SHA-256 of every exported file except the manifest itself.
 *
 * Usage: node scripts/build-manifest.mjs [--check] [--dist ../dist] [--deployment path] [--network path] [--abi-dir path]
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { keccak256, stringToHex } from 'viem';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, '..');
const repoRoot = resolve(webRoot, '..');

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const check = args.includes('--check');
const distDir = resolve(webRoot, flag('--dist', '../dist'));
const deploymentPath = resolve(webRoot, flag('--deployment', 'handoff/deployment.json'));
const networkPath = resolve(webRoot, flag('--network', 'handoff/network.json'));
const abiDir = resolve(webRoot, flag('--abi-dir', '../docs/abi'));

const MAX_ASSETS = 128;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 24 * 1024 * 1024; // keep well under half of the checker's 64 MiB budget

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, sortKeys(value[k])]));
  }
  return value;
}
const canonicalAbiHash = (abi) => keccak256(stringToHex(JSON.stringify(sortKeys(abi)))).slice(2);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile()) out.push(full);
  }
  return out.sort();
}

function fail(message) {
  console.error(`build-manifest: ${message}`);
  process.exit(1);
}

if (!existsSync(distDir) || !existsSync(join(distDir, 'index.html'))) fail(`no export at ${distDir}; run vite build first`);
if (!existsSync(deploymentPath)) fail(`deployment handoff not found at ${deploymentPath}`);
if (!existsSync(networkPath)) fail(`network handoff not found at ${networkPath}`);

const deployment = JSON.parse(readFileSync(deploymentPath, 'utf8'));
const network = JSON.parse(readFileSync(networkPath, 'utf8')).network;
if (!network || network.chainId !== deployment.chainId) fail('network block chainId does not match the deployment handoff');

// ABIs: copy from the pinned source export and verify their canonical Keccak hashes.
const abiOut = join(distDir, 'abi');
const contracts = [];
for (const c of deployment.contracts) {
  const src = join(abiDir, `${c.name}.json`);
  if (!existsSync(src)) fail(`ABI for ${c.name} not found at ${src}`);
  const abi = JSON.parse(readFileSync(src, 'utf8'));
  if (!Array.isArray(abi)) fail(`ABI for ${c.name} is not a JSON array`);
  const hash = canonicalAbiHash(abi);
  if (hash !== c.abiHash) fail(`ABI hash mismatch for ${c.name}: handoff ${c.abiHash}, computed ${hash}`);
  const abiPath = `abi/${c.name}.json`;
  const bytes = Buffer.from(JSON.stringify(abi));
  const dest = join(distDir, abiPath);
  if (check) {
    if (!existsSync(dest) || !readFileSync(dest).equals(bytes)) fail(`${abiPath} in dist/ is missing or stale`);
  } else {
    mkdirSync(abiOut, { recursive: true });
    writeFileSync(dest, bytes);
  }
  contracts.push({ name: c.name, address: c.address, abiHash: c.abiHash, abiPath });
  console.log(`ABI ${c.name}: hash ${hash.slice(0, 12)}… verified → ${abiPath}`);
}

// Assets: every exported file except the manifest itself.
const manifestPath = join(distDir, 'imd-deployment.json');
const files = walk(distDir).filter((f) => f !== manifestPath);
let total = 0;
const assets = files.map((f) => {
  const bytes = readFileSync(f);
  if (bytes.length > MAX_FILE_BYTES) fail(`${f} exceeds ${MAX_FILE_BYTES} bytes`);
  total += bytes.length;
  return { path: relative(distDir, f).split('\\').join('/'), sha256: sha256(bytes) };
});
if (assets.length > MAX_ASSETS) fail(`${assets.length} assets exceed the ${MAX_ASSETS} limit`);
if (total > MAX_TOTAL_BYTES) fail(`export totals ${total} bytes, above the ${MAX_TOTAL_BYTES} budget`);
if (!assets.some((a) => a.path === 'index.html')) fail('index.html missing from assets');
for (const a of assets) {
  if (a.path.startsWith('/') || a.path.split('/').some((s) => s === '..' || s === '.' || s === '')) fail(`unsafe asset path ${a.path}`);
}

const manifest = {
  version: 1,
  launchId: deployment.launchId,
  chainId: deployment.chainId,
  sourceCommit: deployment.sourceCommit,
  attestationHash: deployment.attestationHash,
  contracts,
  assets,
  network,
};
const output = `${JSON.stringify(manifest, null, 2)}\n`;

if (check) {
  if (!existsSync(manifestPath)) fail('dist/imd-deployment.json is missing');
  const current = readFileSync(manifestPath, 'utf8');
  if (current !== output) fail('dist/imd-deployment.json is stale; rerun the build');
  console.log(`manifest OK: ${assets.length} assets, ${total} bytes, ${contracts.length} contracts`);
} else {
  writeFileSync(manifestPath, output);
  console.log(`wrote ${relative(repoRoot, manifestPath)}: ${assets.length} assets, ${total} bytes, ${contracts.length} contracts`);
}
statSync(manifestPath);
