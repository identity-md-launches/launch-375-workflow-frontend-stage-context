import { afterEach, describe, expect, it, vi } from 'vitest';
import { canonicalAbiHash, chainFromNetwork, isSafeRelativePath, loadDeployment, validateManifest, walletAddChainParams } from './deployment';
import { abis, buildManifest, handoff, networkHandoff } from './test/fixtures';

describe('manifest validation', () => {
  it('accepts the manifest built from the handoff', () => {
    const m = buildManifest();
    expect(m.chainId).toBe(11155111);
    expect(m.contracts.map((c) => c.name)).toEqual(['MAXT', 'MaxTxHook']);
  });

  it('rejects unsafe ABI and asset paths', () => {
    expect(isSafeRelativePath('abi/MAXT.json')).toBe(true);
    expect(isSafeRelativePath('../abi/MAXT.json')).toBe(false);
    expect(isSafeRelativePath('/abi/MAXT.json')).toBe(false);
    expect(isSafeRelativePath('https://example.com/abi.json')).toBe(false);
    expect(isSafeRelativePath('abi//MAXT.json')).toBe(false);
    const m = buildManifest();
    expect(() => validateManifest({ ...m, contracts: [{ ...m.contracts[0]!, abiPath: '../x.json' }] })).toThrow(/unsafe abiPath/);
    expect(() => validateManifest({ ...m, assets: [{ path: 'http://x/y', sha256: '0'.repeat(64) }] })).toThrow(/unsafe path/);
  });

  it('rejects a network block whose chain disagrees with the manifest', () => {
    const m = buildManifest();
    expect(() => validateManifest({ ...m, network: { ...m.network, chainId: 1 } })).toThrow(/chainId does not match/);
    expect(() => validateManifest({ ...m, version: 2 })).toThrow(/version/);
    expect(() => validateManifest({ ...m, network: { ...m.network, rpcUrls: ['http://insecure'] } })).toThrow(/https/);
  });
});

describe('ABI hashes', () => {
  it('computes the canonical Keccak hash (sorted keys, no whitespace) that the handoff attests', () => {
    for (const c of handoff.contracts) {
      expect(canonicalAbiHash(abis[c.name])).toBe(c.abiHash);
    }
  });
});

describe('network derivations', () => {
  it('derives wallet_addEthereumChain parameters byte-equal to the handoff walletAddChain', () => {
    expect(walletAddChainParams(networkHandoff.network)).toEqual(networkHandoff.walletAddChain);
  });

  it('builds the wagmi chain from the network block', () => {
    const chain = chainFromNetwork(networkHandoff.network);
    expect(chain.id).toBe(11155111);
    expect(chain.rpcUrls.default.http).toEqual(networkHandoff.network.rpcUrls);
    expect(chain.blockExplorers?.default.url).toBe(networkHandoff.network.explorer);
    expect(chain.testnet).toBe(true);
  });
});

describe('runtime loading', () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubFetch(files: Record<string, unknown>) {
    vi.stubGlobal('fetch', async (url: string) => {
      const path = new URL(url).pathname.replace(/^\/site\//, '');
      if (!(path in files)) return new Response('not found', { status: 404 });
      return new Response(JSON.stringify(files[path]), { status: 200, headers: { 'content-type': 'application/json' } });
    });
  }

  it('loads the manifest and ABIs relative to the page and verifies hashes', async () => {
    const manifest = buildManifest();
    stubFetch({ 'imd-deployment.json': manifest, 'abi/MAXT.json': abis.MAXT, 'abi/MaxTxHook.json': abis.MaxTxHook });
    const d = await loadDeployment('https://gateway.example/site/index.html');
    expect(d.token.address).toBe(handoff.contracts[0]!.address.toLowerCase());
    expect(d.hook.abi.length).toBe(abis.MaxTxHook!.length);
    expect(d.network.uniswapV4.universalRouter).toBe(networkHandoff.network.uniswapV4.universalRouter);
    expect(d.walletAddChain).toEqual(networkHandoff.walletAddChain);
  });

  it('refuses an ABI whose hash disagrees with the manifest', async () => {
    const manifest = buildManifest();
    const tampered = [...(abis.MaxTxHook as unknown[]), { type: 'function', name: 'mint', inputs: [], outputs: [], stateMutability: 'nonpayable' }];
    stubFetch({ 'imd-deployment.json': manifest, 'abi/MAXT.json': abis.MAXT, 'abi/MaxTxHook.json': tampered });
    await expect(loadDeployment('https://gateway.example/site/')).rejects.toThrow(/ABI hash mismatch for MaxTxHook/);
  });

  it('refuses a missing manifest', async () => {
    stubFetch({});
    await expect(loadDeployment('https://gateway.example/site/')).rejects.toThrow(/HTTP 404/);
  });
});
