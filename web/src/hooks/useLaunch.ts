import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAccount, useBalance, useBlockNumber, usePublicClient, useReadContracts } from 'wagmi';
import { parseEventLogs, type Address, type Hex } from 'viem';
import { erc20Abi, permit2Abi, poolManagerAbi, stateViewAbi } from '../abi/uniswap';
import { READS, TOKEN_META } from '../config';
import type { Deployment } from '../deployment';
import { buildPoolKey, poolIdOf, type PoolKey } from '../lib/pool';

export interface CodeStatus {
  name: string;
  address: Address;
  hasCode: boolean | undefined;
}

export interface HookState {
  cap?: bigint;
  windowBlocks?: bigint;
  endBlock?: bigint;
  isCapActive?: boolean;
  blocksRemaining?: bigint;
}

export interface PoolState {
  sqrtPriceX96?: bigint;
  tick?: number;
  protocolFee?: number;
  lpFee?: number;
  liquidity?: bigint;
  initialized?: boolean;
}

export interface TokenState {
  name: string;
  symbol: string;
  decimals: number;
  totalSupply?: bigint;
}

export interface CapWindowEvent {
  poolId: Hex;
  endBlock: bigint;
  blockNumber: bigint;
  transactionHash: Hex;
}

export interface SwapEvent {
  blockNumber: bigint;
  transactionHash: Hex;
  sender: Address;
  amount0: bigint;
  amount1: bigint;
  sqrtPriceX96: bigint;
  tick: number;
}

export interface LaunchData {
  poolKey: PoolKey;
  poolId: Hex;
  blockNumber?: bigint;
  hook: HookState;
  pool: PoolState;
  token: TokenState;
  readsError?: string;
  readsLoading: boolean;
  codes: CodeStatus[];
  codesReady: boolean;
  allCodeVerified: boolean;
  events: { capWindows: CapWindowEvent[]; swaps: SwapEvent[]; error?: string; loading: boolean; fromBlock?: bigint };
  account: {
    address?: Address;
    ethBalance?: bigint;
    tokenBalance?: bigint;
    permit2Allowance?: bigint;
    routerAllowance?: { amount: bigint; expiration: number };
  };
  refetchAccount: () => void;
  refetchReads: () => void;
}

/** All chain reads the page shows, refreshed on every polled block. */
export function useLaunch(deployment: Deployment): LaunchData {
  const { hook, token, network, chain } = deployment;
  const uni = network.uniswapV4;
  const poolKey = useMemo(() => buildPoolKey(token.address, hook.address), [token.address, hook.address]);
  const poolId = useMemo(() => poolIdOf(poolKey), [poolKey]);
  const publicClient = usePublicClient({ chainId: chain.id });
  const { address } = useAccount();

  const { data: blockNumber } = useBlockNumber({ chainId: chain.id, watch: true, query: { refetchInterval: READS.pollingIntervalMs } });

  const reads = useReadContracts({
    allowFailure: true,
    contracts: [
      { address: hook.address, abi: hook.abi, functionName: 'CAP' },
      { address: hook.address, abi: hook.abi, functionName: 'WINDOW_BLOCKS' },
      { address: hook.address, abi: hook.abi, functionName: 'endBlock', args: [poolId] },
      { address: hook.address, abi: hook.abi, functionName: 'isCapActive', args: [poolId] },
      { address: hook.address, abi: hook.abi, functionName: 'blocksRemaining', args: [poolId] },
      { address: uni.stateView, abi: stateViewAbi, functionName: 'getSlot0', args: [poolId] },
      { address: uni.stateView, abi: stateViewAbi, functionName: 'getLiquidity', args: [poolId] },
      { address: token.address, abi: erc20Abi, functionName: 'name' },
      { address: token.address, abi: erc20Abi, functionName: 'symbol' },
      { address: token.address, abi: erc20Abi, functionName: 'decimals' },
      { address: token.address, abi: erc20Abi, functionName: 'totalSupply' },
    ],
    query: { refetchInterval: READS.pollingIntervalMs },
  });

  const r = reads.data;
  const val = <T,>(i: number): T | undefined => {
    const item = r?.[i];
    return item && item.status === 'success' ? (item.result as T) : undefined;
  };
  const slot0 = val<readonly [bigint, number, number, number]>(5);
  const hookState: HookState = {
    cap: val<bigint>(0),
    windowBlocks: val<bigint>(1),
    endBlock: val<bigint>(2),
    isCapActive: val<boolean>(3),
    blocksRemaining: val<bigint>(4),
  };
  const poolState: PoolState = {
    sqrtPriceX96: slot0?.[0],
    tick: slot0?.[1],
    protocolFee: slot0?.[2],
    lpFee: slot0?.[3],
    liquidity: val<bigint>(6),
    initialized: slot0 ? slot0[0] !== 0n : undefined,
  };
  const tokenState: TokenState = {
    name: val<string>(7) ?? TOKEN_META.name,
    symbol: val<string>(8) ?? TOKEN_META.symbol,
    decimals: val<number>(9) ?? TOKEN_META.decimals,
    totalSupply: val<bigint>(10),
  };
  const failedRead = r?.find((item) => item.status === 'failure');
  const readsError = reads.error
    ? 'Unable to read the contracts from the public RPC. Check your connection and retry.'
    : failedRead
      ? 'Some contract reads failed on the public RPC. Values may be incomplete.'
      : undefined;

  const codeTargets = useMemo(
    () => [
      { name: token.name, address: token.address },
      { name: hook.name, address: hook.address },
      { name: 'PoolManager', address: uni.poolManager },
      { name: 'Universal Router', address: uni.universalRouter },
      { name: 'V4 Quoter', address: uni.quoter },
      { name: 'StateView', address: uni.stateView },
      { name: 'Permit2', address: uni.permit2 },
    ],
    [token, hook, uni],
  );
  const codes = useQuery({
    queryKey: ['code', chain.id, codeTargets.map((t) => t.address)],
    enabled: !!publicClient,
    staleTime: Infinity,
    queryFn: async () => {
      const results = await Promise.all(
        codeTargets.map(async (t) => {
          const code = await publicClient!.getCode({ address: t.address });
          return { ...t, hasCode: !!code && code !== '0x' };
        }),
      );
      return results;
    },
  });
  const codeStatuses: CodeStatus[] = codes.data ?? codeTargets.map((t) => ({ ...t, hasCode: undefined }));
  const allCodeVerified = !!codes.data && codes.data.every((c) => c.hasCode);

  // The hook records endBlock = initialization block + WINDOW_BLOCKS, so the CapWindowStarted event
  // sits in exactly one known block. Public RPCs refuse unbounded log ranges, so never query from 0.
  const initBlock =
    hookState.endBlock !== undefined && hookState.windowBlocks !== undefined && hookState.endBlock > hookState.windowBlocks
      ? hookState.endBlock - hookState.windowBlocks
      : undefined;
  const events = useQuery({
    queryKey: ['events', chain.id, hook.address, poolId, initBlock?.toString() ?? 'none', blockNumber ? (blockNumber / 10n).toString() : 'init'],
    enabled: !!publicClient && !!blockNumber && hookState.endBlock !== undefined,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const latest = blockNumber!;
      const capEvent = hook.abi.find((item) => item.type === 'event' && item.name === 'CapWindowStarted');
      let capLogs: CapWindowEvent[] = [];
      let error: string | undefined;
      if (initBlock !== undefined) {
        try {
          const logs = await publicClient!.getLogs({ address: hook.address, event: capEvent as never, args: { poolId } as never, fromBlock: initBlock, toBlock: initBlock });
          capLogs = parseEventLogs({ abi: hook.abi, eventName: 'CapWindowStarted', logs }).map((l) => {
            const args = l.args as unknown as { poolId: Hex; endBlock: bigint };
            return { poolId: args.poolId, endBlock: args.endBlock, blockNumber: l.blockNumber, transactionHash: l.transactionHash };
          });
        } catch {
          error = 'Unable to load the CapWindowStarted event from the public RPC.';
        }
      }
      // Swaps: from the pool's initialization block, bounded to the configured lookback.
      const lookbackFrom = latest > READS.eventLookbackBlocks ? latest - READS.eventLookbackBlocks : 0n;
      const swapFrom = initBlock !== undefined && initBlock > lookbackFrom ? initBlock : lookbackFrom;
      let swaps: SwapEvent[] = [];
      try {
        const logs = await publicClient!.getLogs({
          address: uni.poolManager,
          event: poolManagerAbi[0],
          args: { id: poolId },
          fromBlock: swapFrom,
          toBlock: latest,
        });
        swaps = logs
          .map((l) => ({
            blockNumber: l.blockNumber,
            transactionHash: l.transactionHash,
            sender: l.args.sender!,
            amount0: l.args.amount0!,
            amount1: l.args.amount1!,
            sqrtPriceX96: l.args.sqrtPriceX96!,
            tick: l.args.tick!,
          }))
          .reverse();
      } catch {
        error = error ?? 'Unable to load swap events from the public RPC.';
      }
      return { capWindows: capLogs, swaps, error, fromBlock: swapFrom };
    },
  });

  const ethBalance = useBalance({ address, chainId: chain.id, query: { enabled: !!address, refetchInterval: READS.pollingIntervalMs } });
  const accountReads = useReadContracts({
    allowFailure: true,
    contracts: address
      ? [
          { address: token.address, abi: erc20Abi, functionName: 'balanceOf', args: [address] },
          { address: token.address, abi: erc20Abi, functionName: 'allowance', args: [address, uni.permit2] },
          { address: uni.permit2, abi: permit2Abi, functionName: 'allowance', args: [address, token.address, uni.universalRouter] },
        ]
      : [],
    query: { enabled: !!address, refetchInterval: READS.pollingIntervalMs },
  });
  const a = accountReads.data;
  const aval = <T,>(i: number): T | undefined => {
    const item = a?.[i];
    return item && item.status === 'success' ? (item.result as T) : undefined;
  };
  const routerAllowanceRaw = aval<readonly [bigint, number, number]>(2);

  return {
    poolKey,
    poolId,
    blockNumber,
    hook: hookState,
    pool: poolState,
    token: tokenState,
    readsError,
    readsLoading: reads.isLoading,
    codes: codeStatuses,
    codesReady: codes.isSuccess,
    allCodeVerified,
    events: {
      capWindows: events.data?.capWindows ?? [],
      swaps: events.data?.swaps ?? [],
      error: events.data?.error ?? (events.error ? 'Unable to load events from the public RPC.' : undefined),
      loading: events.isLoading,
      fromBlock: events.data?.fromBlock,
    },
    account: {
      address,
      ethBalance: ethBalance.data?.value,
      tokenBalance: aval<bigint>(0),
      permit2Allowance: aval<bigint>(1),
      routerAllowance: routerAllowanceRaw ? { amount: routerAllowanceRaw[0], expiration: routerAllowanceRaw[1] } : undefined,
    },
    refetchAccount: () => {
      void accountReads.refetch();
      void ethBalance.refetch();
    },
    refetchReads: () => {
      void reads.refetch();
      void events.refetch();
    },
  };
}
