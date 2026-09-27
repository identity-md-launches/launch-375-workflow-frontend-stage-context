/**
 * Shared test fixtures: the deployment handoff, network block and pinned ABIs read from the
 * repository, plus a fake JSON-RPC backend and a mock EIP-1193 wallet.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  custom,
  decodeFunctionData,
  encodeAbiParameters,
  encodeErrorResult,
  encodeEventTopics,
  encodeFunctionResult,
  keccak256,
  stringToHex,
  type Abi,
  type Address,
  type Hex,
} from 'viem';
import { erc20Abi, permit2Abi, poolManagerAbi, quoterAbi, stateViewAbi, universalRouterAbi } from '../abi/uniswap';
import { canonicalAbiHash, chainFromNetwork, validateManifest, walletAddChainParams, type Deployment, type DeploymentManifest } from '../deployment';
import { buildPoolKey, poolIdOf } from '../lib/pool';

const webRoot = resolve(__dirname, '../..');
export const handoff = JSON.parse(readFileSync(resolve(webRoot, 'handoff/deployment.json'), 'utf8')) as {
  chainId: number;
  launchId: string;
  sourceCommit: string;
  attestationHash: string;
  contracts: { name: string; address: Address; abiHash: string; blockNumber: number }[];
};
export const networkHandoff = JSON.parse(readFileSync(resolve(webRoot, 'handoff/network.json'), 'utf8')) as {
  network: DeploymentManifest['network'];
  walletAddChain: ReturnType<typeof walletAddChainParams>;
};
export const abis: Record<string, Abi> = Object.fromEntries(
  handoff.contracts.map((c) => [c.name, JSON.parse(readFileSync(resolve(webRoot, `../docs/abi/${c.name}.json`), 'utf8')) as Abi]),
);

/** The manifest exactly as scripts/build-manifest.mjs would write it (asset list is illustrative). */
export function buildManifest(): DeploymentManifest {
  return validateManifest({
    version: 1,
    launchId: handoff.launchId,
    chainId: handoff.chainId,
    sourceCommit: handoff.sourceCommit,
    attestationHash: handoff.attestationHash,
    contracts: handoff.contracts.map((c) => ({ name: c.name, address: c.address, abiHash: c.abiHash, abiPath: `abi/${c.name}.json` })),
    assets: [{ path: 'index.html', sha256: '0'.repeat(64) }],
    network: networkHandoff.network,
  });
}

export function buildDeployment(): Deployment {
  const manifest = buildManifest();
  const contracts = manifest.contracts.map((c) => ({ ...c, abi: abis[c.name]! }));
  return {
    manifest,
    chain: chainFromNetwork(manifest.network),
    network: manifest.network,
    token: contracts.find((c) => c.name === 'MAXT')!,
    hook: contracts.find((c) => c.name === 'MaxTxHook')!,
    contracts,
    walletAddChain: walletAddChainParams(manifest.network),
  };
}

export const CAP = 5_000_000n * 10n ** 18n;
export const SQRT_PRICE = 792281625142643375935439503360000n; // 100,000,000 MAXT per ETH
export const RICH = '0x232e274676e865e341b02348a2173e8856891b0a' as Address;
export const TX_HASH = ('0x' + 'ab'.repeat(32)) as Hex;

export interface FakeChainState {
  blockNumber: bigint;
  endBlock: bigint;
  ethBalance: bigint;
  tokenBalance: bigint;
  permit2Allowance: bigint;
  routerAllowance: { amount: bigint; expiration: number };
  /** amountOut the fake quoter returns per wei of input (fixed rate) — or a function raising a revert. */
  quoteRate: bigint;
  sentTransactions: { to: Address; data: Hex; value: bigint; from: Address }[];
  calls: { method: string; params: unknown }[];
}

export function defaultState(): FakeChainState {
  return {
    blockNumber: 11_791_700n,
    endBlock: 11_798_676n,
    ethBalance: 10n * 10n ** 18n,
    tokenBalance: 0n,
    permit2Allowance: 0n,
    routerAllowance: { amount: 0n, expiration: 0 },
    quoteRate: 49_000_000n, // 0.01 ETH → 490,000 MAXT
    sentTransactions: [],
    calls: [],
  };
}

const hex = (v: bigint | number) => `0x${BigInt(v).toString(16)}` as Hex;
const abiHashOk = (name: string) => canonicalAbiHash(abis[name]) === handoff.contracts.find((c) => c.name === name)!.abiHash;
if (!abiHashOk('MAXT') || !abiHashOk('MaxTxHook')) throw new Error('fixture ABIs do not match the handoff hashes');

/** A JSON-RPC backend that answers exactly the calls the page makes, from `state`. */
export function fakeRpc(deployment: Deployment, state: FakeChainState) {
  const uni = deployment.network.uniswapV4;
  const token = deployment.token.address.toLowerCase();
  const hook = deployment.hook.address.toLowerCase();
  const key = buildPoolKey(deployment.token.address, deployment.hook.address);
  const poolId = poolIdOf(key);

  const answerCall = (to: string, data: Hex, from?: string): Hex => {
    to = to.toLowerCase();
    if (to === hook) {
      const { functionName, args } = decodeFunctionData({ abi: deployment.hook.abi, data });
      const active = state.blockNumber < state.endBlock;
      const result: Record<string, unknown> = {
        CAP: CAP,
        WINDOW_BLOCKS: 7200n,
        endBlock: state.endBlock,
        isCapActive: active,
        blocksRemaining: active ? state.endBlock - state.blockNumber : 0n,
        poolManager: uni.poolManager,
      };
      void args;
      return encodeFunctionResult({ abi: deployment.hook.abi, functionName, result: result[functionName] as never });
    }
    if (to === token) {
      const { functionName, args } = decodeFunctionData({ abi: erc20Abi, data });
      const results: Record<string, unknown> = {
        name: 'Maxtx',
        symbol: 'MAXT',
        decimals: 18,
        totalSupply: 1_000_000_000n * 10n ** 18n,
        balanceOf: state.tokenBalance,
        allowance: state.permit2Allowance,
        approve: true,
      };
      void args;
      return encodeFunctionResult({ abi: erc20Abi, functionName, result: results[functionName] as never });
    }
    if (to === uni.stateView.toLowerCase()) {
      const { functionName } = decodeFunctionData({ abi: stateViewAbi, data });
      if (functionName === 'getSlot0') return encodeFunctionResult({ abi: stateViewAbi, functionName, result: [SQRT_PRICE, 177_284, 0, 3000] });
      return encodeFunctionResult({ abi: stateViewAbi, functionName: 'getLiquidity', result: 0n });
    }
    if (to === uni.permit2.toLowerCase()) {
      const { functionName } = decodeFunctionData({ abi: permit2Abi, data });
      if (functionName === 'allowance') {
        return encodeFunctionResult({ abi: permit2Abi, functionName, result: [state.routerAllowance.amount, state.routerAllowance.expiration, 0] });
      }
      return '0x';
    }
    if (to === uni.quoter.toLowerCase()) {
      const { args } = decodeFunctionData({ abi: quoterAbi, data });
      const params = args[0];
      const amountOut = params.zeroForOne ? params.exactAmount * state.quoteRate : params.exactAmount / state.quoteRate;
      if (params.zeroForOne && state.blockNumber < state.endBlock && amountOut > CAP) {
        // Reproduce the real nesting: UnexpectedRevertBytes(WrappedError(hook, afterSwap, CapExceeded(cap, out), HookCallFailed))
        const inner = encodeErrorResult({ abi: deployment.hook.abi, errorName: 'CapExceeded', args: [CAP, amountOut] });
        const wrapped = encodeErrorResult({
          abi: poolManagerAbi,
          errorName: 'WrappedError',
          args: [deployment.hook.address, '0xb47b2fb1', inner, encodeErrorResult({ abi: poolManagerAbi, errorName: 'HookCallFailed' })],
        });
        throw rpcError(3, 'execution reverted', encodeErrorResult({ abi: quoterAbi, errorName: 'UnexpectedRevertBytes', args: [wrapped] }));
      }
      return encodeFunctionResult({ abi: quoterAbi, functionName: 'quoteExactInputSingle', result: [amountOut, 100_000n] });
    }
    if (to === uni.universalRouter.toLowerCase()) {
      decodeFunctionData({ abi: universalRouterAbi, data }); // throws if malformed
      void from;
      return '0x';
    }
    throw new Error(`fakeRpc: unexpected eth_call to ${to}`);
  };

  const capTopics = encodeEventTopics({ abi: deployment.hook.abi, eventName: 'CapWindowStarted', args: { poolId } as never });
  const capLog = {
    address: deployment.hook.address,
    topics: capTopics,
    data: encodeAbiParameters([{ type: 'uint256' }], [state.endBlock]),
    blockNumber: hex(state.endBlock - 7200n),
    transactionHash: ('0x' + '11'.repeat(32)) as Hex,
    transactionIndex: '0x0',
    blockHash: ('0x' + '22'.repeat(32)) as Hex,
    logIndex: '0x0',
    removed: false,
  };
  const swapTopics = encodeEventTopics({ abi: poolManagerAbi, eventName: 'Swap', args: { id: poolId, sender: uni.universalRouter } });
  const swapLog = {
    address: uni.poolManager,
    topics: swapTopics,
    data: encodeAbiParameters(
      [{ type: 'int128' }, { type: 'int128' }, { type: 'uint160' }, { type: 'uint128' }, { type: 'int24' }, { type: 'uint24' }],
      [-(10n ** 16n), 490_000n * 10n ** 18n, SQRT_PRICE, 0n, 177_284, 3000],
    ),
    blockNumber: hex(state.endBlock - 7100n),
    transactionHash: ('0x' + '33'.repeat(32)) as Hex,
    transactionIndex: '0x0',
    blockHash: ('0x' + '44'.repeat(32)) as Hex,
    logIndex: '0x1',
    removed: false,
  };

  const request = async ({ method, params }: { method: string; params?: unknown }): Promise<unknown> => {
    state.calls.push({ method, params });
    const p = (params ?? []) as unknown[];
    switch (method) {
      case 'eth_chainId':
        return hex(deployment.chain.id);
      case 'eth_blockNumber':
        return hex(state.blockNumber);
      case 'eth_getCode':
        return '0x6000';
      case 'eth_getBalance':
        return hex(state.ethBalance);
      case 'eth_call': {
        const call = p[0] as { to: string; data: Hex; from?: string };
        return answerCall(call.to, call.data, call.from);
      }
      case 'eth_estimateGas':
        return '0x30000';
      case 'eth_gasPrice':
      case 'eth_maxPriorityFeePerGas':
        return '0x3b9aca00';
      case 'eth_getBlockByNumber':
        return { number: hex(state.blockNumber), baseFeePerGas: '0x3b9aca00', timestamp: hex(Math.floor(Date.now() / 1000)), hash: '0x' + '55'.repeat(32), transactions: [] };
      case 'eth_getLogs': {
        const filter = p[0] as { address?: string; topics?: (string | null)[] };
        const addr = (filter.address ?? '').toLowerCase();
        if (addr === hook) return [capLog];
        if (addr === uni.poolManager.toLowerCase()) return [swapLog];
        return [];
      }
      case 'eth_getTransactionReceipt': {
        const hash = p[0] as Hex;
        return {
          transactionHash: hash,
          status: '0x1',
          blockNumber: hex(state.blockNumber),
          blockHash: '0x' + '66'.repeat(32),
          transactionIndex: '0x0',
          from: RICH,
          to: uni.universalRouter,
          cumulativeGasUsed: '0x30000',
          gasUsed: '0x30000',
          effectiveGasPrice: '0x3b9aca00',
          logs: [],
          logsBloom: '0x' + '00'.repeat(256),
          type: '0x2',
        };
      }
      case 'eth_getTransactionByHash':
        return { hash: p[0], blockNumber: hex(state.blockNumber), from: RICH, to: uni.universalRouter, value: '0x0', nonce: '0x1', input: '0x', gas: '0x30000', blockHash: '0x' + '66'.repeat(32), transactionIndex: '0x0', type: '0x2', chainId: hex(deployment.chain.id) };
      case 'eth_getTransactionCount':
        return '0x1';
      default:
        throw new Error(`fakeRpc: unhandled ${method}`);
    }
  };
  return { request, transport: custom({ request }), poolId };
}

function rpcError(code: number, message: string, data: Hex) {
  return Object.assign(new Error(message), { code, data });
}

/** A mock EIP-1193 wallet. Unknown chains raise 4902 until wallet_addEthereumChain registers them. */
export function mockWallet(options: { account: Address; chainId: Hex; known?: Hex[]; rpc: (req: { method: string; params?: unknown }) => Promise<unknown>; state: FakeChainState; rejectSend?: boolean }) {
  let chainId = options.chainId;
  let authorized = false;
  const known = new Set<Hex>(options.known ?? [options.chainId]);
  const listeners: Record<string, ((v: unknown) => void)[]> = {};
  const log: { method: string; params: unknown }[] = [];
  const emit = (event: string, value: unknown) => (listeners[event] ?? []).forEach((fn) => fn(value));
  const provider = {
    on(event: string, fn: (v: unknown) => void) {
      (listeners[event] ??= []).push(fn);
    },
    removeListener(event: string, fn: (v: unknown) => void) {
      listeners[event] = (listeners[event] ?? []).filter((x) => x !== fn);
    },
    async request({ method, params }: { method: string; params?: unknown }): Promise<unknown> {
      log.push({ method, params });
      const p = (params ?? []) as unknown[];
      switch (method) {
        case 'eth_chainId':
          return chainId;
        case 'eth_accounts':
          return authorized ? [options.account] : [];
        case 'eth_requestAccounts':
          authorized = true;
          return [options.account];
        case 'wallet_switchEthereumChain': {
          const target = (p[0] as { chainId: Hex }).chainId;
          if (!known.has(target)) throw Object.assign(new Error(`Unrecognized chain ID "${target}". Try adding the chain using wallet_addEthereumChain first.`), { code: 4902 });
          chainId = target;
          emit('chainChanged', chainId);
          return null;
        }
        case 'wallet_addEthereumChain':
          known.add((p[0] as { chainId: Hex }).chainId);
          return null;
        case 'eth_sendTransaction': {
          if (options.rejectSend) throw Object.assign(new Error('User rejected the request.'), { code: 4001 });
          const tx = p[0] as { to: Address; data: Hex; value?: Hex; from: Address };
          options.state.sentTransactions.push({ to: tx.to, data: tx.data, value: tx.value ? BigInt(tx.value) : 0n, from: tx.from });
          return TX_HASH;
        }
        case 'wallet_getCapabilities':
        case 'wallet_revokePermissions':
          throw Object.assign(new Error('Unsupported method'), { code: 4200 });
        default:
          return options.rpc({ method, params });
      }
    },
  };
  return { provider: provider as unknown as import('viem').EIP1193Provider, log, currentChainId: () => chainId };
}

export const abiHashOf = (abi: unknown) => keccak256(stringToHex(JSON.stringify(abi))).slice(2);
