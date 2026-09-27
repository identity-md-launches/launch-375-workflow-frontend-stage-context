import {
  BaseError,
  ContractFunctionRevertedError,
  decodeErrorResult,
  encodeAbiParameters,
  encodeFunctionData,
  toHex,
  type Abi,
  type Hex,
} from 'viem';
import {
  poolManagerAbi,
  quoterAbi,
  universalRouterAbi,
  UR_COMMAND_V4_SWAP,
  V4_ACTION_SETTLE_ALL,
  V4_ACTION_SWAP_EXACT_IN_SINGLE,
  V4_ACTION_TAKE_ALL,
} from '../abi/uniswap';
import type { PoolKey } from './pool';

const POOL_KEY_TUPLE = {
  type: 'tuple',
  components: [
    { name: 'currency0', type: 'address' },
    { name: 'currency1', type: 'address' },
    { name: 'fee', type: 'uint24' },
    { name: 'tickSpacing', type: 'int24' },
    { name: 'hooks', type: 'address' },
  ],
} as const;

export interface SwapPlan {
  key: PoolKey;
  zeroForOne: boolean;
  amountIn: bigint;
  amountOutMinimum: bigint;
  deadline: bigint;
}

export interface RouterCall {
  commands: Hex;
  inputs: readonly Hex[];
  deadline: bigint;
  value: bigint;
  data: Hex;
}

/**
 * Encode `execute(commands, inputs, deadline)` for a single exact-input v4 swap:
 * commands = V4_SWAP; inputs[0] = abi.encode(actions, params) with actions
 * SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL.
 */
export function encodeUniversalRouterSwap(plan: SwapPlan): RouterCall {
  const { key, zeroForOne, amountIn, amountOutMinimum, deadline } = plan;
  const inputCurrency = zeroForOne ? key.currency0 : key.currency1;
  const outputCurrency = zeroForOne ? key.currency1 : key.currency0;

  const actions = toHex(new Uint8Array([V4_ACTION_SWAP_EXACT_IN_SINGLE, V4_ACTION_SETTLE_ALL, V4_ACTION_TAKE_ALL]));
  const swapParams = encodeAbiParameters(
    [
      {
        type: 'tuple',
        components: [
          { name: 'poolKey', ...POOL_KEY_TUPLE },
          { name: 'zeroForOne', type: 'bool' },
          { name: 'amountIn', type: 'uint128' },
          { name: 'amountOutMinimum', type: 'uint128' },
          { name: 'hookData', type: 'bytes' },
        ],
      },
    ],
    [{ poolKey: key, zeroForOne, amountIn, amountOutMinimum, hookData: '0x' }],
  );
  const settleParams = encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [inputCurrency, amountIn]);
  const takeParams = encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [outputCurrency, amountOutMinimum]);

  const v4Input = encodeAbiParameters([{ type: 'bytes' }, { type: 'bytes[]' }], [actions, [swapParams, settleParams, takeParams]]);
  const commands = toHex(new Uint8Array([UR_COMMAND_V4_SWAP]));
  const inputs = [v4Input] as const;
  const isNativeIn = inputCurrency === '0x0000000000000000000000000000000000000000';
  const value = isNativeIn ? amountIn : 0n;
  const data = encodeFunctionData({ abi: universalRouterAbi, functionName: 'execute', args: [commands, inputs, deadline] });
  return { commands, inputs, deadline, value, data };
}

export interface DecodedRevert {
  /** Short machine-friendly kind. */
  kind: 'capExceeded' | 'notEnoughLiquidity' | 'tooLittleReceived' | 'deadline' | 'other';
  /** Human sentence explaining the failure and how to fix it. */
  message: string;
  /** For capExceeded: cap and the output the swap would have delivered. */
  cap?: bigint;
  requested?: bigint;
}

function tryDecode(data: Hex, abi: Abi): { errorName: string; args: readonly unknown[] } | undefined {
  try {
    const decoded = decodeErrorResult({ abi, data });
    return { errorName: decoded.errorName, args: decoded.args ?? [] };
  } catch {
    return undefined;
  }
}

/**
 * Walk a revert payload through the nesting the v4 stack produces:
 * quoter `UnexpectedRevertBytes(bytes)` → PoolManager `WrappedError(target, selector, reason, details)`
 * → hook `CapExceeded(cap, requested)` (or any other hook/router error).
 */
export function decodeRevertData(data: Hex | undefined, hookAbi: Abi, tokenSymbol: string, formatToken: (v: bigint) => string): DecodedRevert {
  if (!data || data === '0x') {
    return { kind: 'other', message: 'The swap simulation reverted without a reason. Check the amount and try again.' };
  }
  let current: Hex = data;
  for (let depth = 0; depth < 6; depth += 1) {
    const hook = tryDecode(current, hookAbi);
    if (hook?.errorName === 'CapExceeded') {
      const [cap, requested] = hook.args as [bigint, bigint];
      return {
        kind: 'capExceeded',
        cap,
        requested,
        message: `This buy would deliver ${formatToken(requested)} ${tokenSymbol}, above the ${formatToken(cap)} ${tokenSymbol} per-buy cap, so the hook would revert it. Reduce the amount.`,
      };
    }
    if (hook && hook.errorName !== 'NotPoolManager') {
      return { kind: 'other', message: `The hook reverted with ${hook.errorName}.` };
    }
    const quoter = tryDecode(current, quoterAbi);
    if (quoter?.errorName === 'UnexpectedRevertBytes') {
      current = quoter.args[0] as Hex;
      continue;
    }
    if (quoter?.errorName === 'NotEnoughLiquidity') {
      return { kind: 'notEnoughLiquidity', message: 'The pool does not have enough liquidity for this amount. Try a smaller amount.' };
    }
    const pm = tryDecode(current, poolManagerAbi);
    if (pm?.errorName === 'WrappedError') {
      current = pm.args[2] as Hex;
      continue;
    }
    if (pm) {
      return { kind: 'other', message: `The pool manager reverted with ${pm.errorName}.` };
    }
    const router = tryDecode(current, universalRouterAbi);
    if (router?.errorName === 'V4TooLittleReceived') {
      return { kind: 'tooLittleReceived', message: 'The output fell below your minimum. Increase the slippage tolerance or refresh the quote.' };
    }
    if (router?.errorName === 'TransactionDeadlinePassed') {
      return { kind: 'deadline', message: 'The transaction deadline passed. Refresh the quote and try again.' };
    }
    if (router?.errorName === 'ExecutionFailed') {
      current = router.args[1] as Hex;
      continue;
    }
    if (router) {
      return { kind: 'other', message: `The router reverted with ${router.errorName}.` };
    }
    break;
  }
  return { kind: 'other', message: `The swap simulation reverted (${current.slice(0, 10)}). Check the amount and try again.` };
}

/** Extract raw revert data from a viem error, if any. */
export function revertDataOf(error: unknown): Hex | undefined {
  if (error instanceof BaseError) {
    const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    if (reverted?.raw) return reverted.raw;
    const withData = error.walk((e) => typeof (e as { data?: unknown }).data === 'string') as { data?: Hex } | null;
    if (withData?.data && withData.data.startsWith('0x')) return withData.data;
  }
  const maybe = error as { data?: unknown; cause?: { data?: unknown } };
  if (typeof maybe?.data === 'string' && maybe.data.startsWith('0x')) return maybe.data as Hex;
  if (typeof maybe?.cause?.data === 'string' && (maybe.cause.data as string).startsWith('0x')) return maybe.cause.data as Hex;
  return undefined;
}

/** Whether an error came from the wallet user rejecting the request. */
export function isUserRejection(error: unknown): boolean {
  const e = error as { code?: number; name?: string; message?: string; cause?: { code?: number } };
  if (e?.code === 4001 || e?.cause?.code === 4001) return true;
  if (e?.name === 'UserRejectedRequestError') return true;
  return /user rejected|user denied|rejected the request/i.test(e?.message ?? '');
}

/** A short, plain sentence for any error surfaced to the visitor. */
export function describeError(error: unknown): string {
  if (isUserRejection(error)) return 'Request rejected in the wallet. Nothing was sent.';
  if (error instanceof BaseError) return error.shortMessage;
  if (error instanceof Error) return error.message;
  return String(error);
}
