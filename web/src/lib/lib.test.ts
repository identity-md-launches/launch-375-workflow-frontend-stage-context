import { describe, expect, it } from 'vitest';
import { decodeAbiParameters, decodeFunctionData, encodeErrorResult, parseEther } from 'viem';
import { poolManagerAbi, quoterAbi, universalRouterAbi } from '../abi/uniswap';
import { applySlippage, buildPoolKey, ethPerTokenWad, poolIdOf, tokenPerEthWad } from './pool';
import { decodeRevertData, encodeUniversalRouterSwap, isUserRejection } from './swap';
import { approxDuration, formatAmount, parseAmount } from './format';
import { abis, CAP, handoff, networkHandoff, SQRT_PRICE } from '../test/fixtures';

const token = handoff.contracts.find((c) => c.name === 'MAXT')!.address;
const hook = handoff.contracts.find((c) => c.name === 'MaxTxHook')!.address;

describe('pool key and id', () => {
  it('matches the live pool id observed on Sepolia (native ETH as currency0, hook from the handoff)', () => {
    const key = buildPoolKey(token, hook);
    expect(key.currency0).toBe('0x0000000000000000000000000000000000000000');
    expect(key.currency1).toBe(token.toLowerCase());
    expect(key.fee).toBe(3000);
    expect(key.tickSpacing).toBe(60);
    expect(key.hooks).toBe(hook.toLowerCase());
    // Verified against hook.endBlock(poolId) != 0 and StateView.getSlot0(poolId) on Sepolia (test/scratch/probe.mjs).
    expect(poolIdOf(key)).toBe('0x556b91ec0f64d169bba115d4bcc075c446740a1875743faf060029211674a0f7');
  });

  it('derives 100,000,000 MAXT per ETH from the manifest initial sqrtPriceX96', () => {
    const wad = tokenPerEthWad(SQRT_PRICE);
    expect(wad).toBe(100_000_000n * 10n ** 18n);
    expect(ethPerTokenWad(wad)).toBe(10n ** 10n); // 1e-8 ETH per MAXT
  });

  it('applies slippage in basis points', () => {
    expect(applySlippage(10_000n, 0.5)).toBe(9_950n);
    expect(applySlippage(10_000n, 0)).toBe(10_000n);
    expect(applySlippage(10_000n, 100)).toBe(0n);
  });
});

describe('universal router encoding', () => {
  const key = buildPoolKey(token, hook);

  it('encodes V4_SWAP with SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL for a native-ETH buy', () => {
    const call = encodeUniversalRouterSwap({ key, zeroForOne: true, amountIn: parseEther('0.01'), amountOutMinimum: 123n, deadline: 999n });
    expect(call.commands).toBe('0x10');
    expect(call.value).toBe(parseEther('0.01'));
    const decoded = decodeFunctionData({ abi: universalRouterAbi, data: call.data });
    expect(decoded.functionName).toBe('execute');
    expect(decoded.args[0]).toBe('0x10');
    expect(decoded.args[2]).toBe(999n);
    const [actions, params] = decodeAbiParameters([{ type: 'bytes' }, { type: 'bytes[]' }], decoded.args[1][0]!);
    expect(actions).toBe('0x060c0f');
    expect(params).toHaveLength(3);
    const [swap] = decodeAbiParameters(
      [
        {
          type: 'tuple',
          components: [
            {
              name: 'poolKey',
              type: 'tuple',
              components: [
                { name: 'currency0', type: 'address' },
                { name: 'currency1', type: 'address' },
                { name: 'fee', type: 'uint24' },
                { name: 'tickSpacing', type: 'int24' },
                { name: 'hooks', type: 'address' },
              ],
            },
            { name: 'zeroForOne', type: 'bool' },
            { name: 'amountIn', type: 'uint128' },
            { name: 'amountOutMinimum', type: 'uint128' },
            { name: 'hookData', type: 'bytes' },
          ],
        },
      ],
      params[0]!,
    );
    expect(swap.zeroForOne).toBe(true);
    expect(swap.amountIn).toBe(parseEther('0.01'));
    expect(swap.amountOutMinimum).toBe(123n);
    expect(swap.poolKey.hooks.toLowerCase()).toBe(hook.toLowerCase());
    const [settleCurrency, settleAmount] = decodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], params[1]!);
    expect(settleCurrency).toBe('0x0000000000000000000000000000000000000000');
    expect(settleAmount).toBe(parseEther('0.01'));
    const [takeCurrency, takeMin] = decodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], params[2]!);
    expect(takeCurrency.toLowerCase()).toBe(token.toLowerCase());
    expect(takeMin).toBe(123n);
  });

  it('sends no value and settles the token for a sell', () => {
    const call = encodeUniversalRouterSwap({ key, zeroForOne: false, amountIn: 5n, amountOutMinimum: 1n, deadline: 1n });
    expect(call.value).toBe(0n);
    const decoded = decodeFunctionData({ abi: universalRouterAbi, data: call.data });
    const [, params] = decodeAbiParameters([{ type: 'bytes' }, { type: 'bytes[]' }], decoded.args[1][0]!);
    const [settleCurrency] = decodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], params[1]!);
    expect(settleCurrency.toLowerCase()).toBe(token.toLowerCase());
  });
});

describe('revert decoding', () => {
  const fmt = (v: bigint) => formatAmount(v, 18, 0);

  it('decodes the real quoter revert captured from Sepolia for a 1 ETH buy', () => {
    // Raw revert data returned by V4Quoter.quoteExactInputSingle on Sepolia (test/scratch/probe.mjs).
    const raw =
      '0x6190b2b00000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000014490bfb865000000000000000000000000b0f72f21b9b98d9be1223662e45e60e88b6a90c0b47b2fb100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000044f480e2850000000000000000000000000000000000000000000422ca8b0a00a42500000000000000000000000000000000000000000000000026a7b0aa52bc50c8f6659a000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000004a9e35b2f0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000' as const;
    const decoded = decodeRevertData(raw, abis.MaxTxHook!, 'MAXT', fmt);
    expect(decoded.kind).toBe('capExceeded');
    expect(decoded.cap).toBe(CAP);
    expect(decoded.requested).toBe(0x26a7b0aa52bc50c8f6659an);
    expect(decoded.message).toContain('above the 5,000,000 MAXT per-buy cap');
    expect(decoded.message).toContain('46,731,075');
  });

  it('decodes a synthetic UnexpectedRevertBytes(WrappedError(CapExceeded)) chain', () => {
    const inner = encodeErrorResult({ abi: abis.MaxTxHook!, errorName: 'CapExceeded', args: [CAP, CAP + 1n] });
    const wrapped = encodeErrorResult({ abi: poolManagerAbi, errorName: 'WrappedError', args: [hook, '0xb47b2fb1', inner, '0x'] });
    const outer = encodeErrorResult({ abi: quoterAbi, errorName: 'UnexpectedRevertBytes', args: [wrapped] });
    expect(decodeRevertData(outer, abis.MaxTxHook!, 'MAXT', fmt).requested).toBe(CAP + 1n);
    expect(decodeRevertData(wrapped, abis.MaxTxHook!, 'MAXT', fmt).kind).toBe('capExceeded');
    expect(decodeRevertData(inner, abis.MaxTxHook!, 'MAXT', fmt).kind).toBe('capExceeded');
  });

  it('explains router slippage and deadline errors', () => {
    const slip = encodeErrorResult({ abi: universalRouterAbi, errorName: 'V4TooLittleReceived', args: [10n, 9n] });
    expect(decodeRevertData(slip, abis.MaxTxHook!, 'MAXT', fmt).kind).toBe('tooLittleReceived');
    const dead = encodeErrorResult({ abi: universalRouterAbi, errorName: 'TransactionDeadlinePassed' });
    expect(decodeRevertData(dead, abis.MaxTxHook!, 'MAXT', fmt).kind).toBe('deadline');
    expect(decodeRevertData('0x', abis.MaxTxHook!, 'MAXT', fmt).kind).toBe('other');
  });

  it('recognizes wallet rejections by code and message', () => {
    expect(isUserRejection({ code: 4001 })).toBe(true);
    expect(isUserRejection(new Error('User rejected the request.'))).toBe(true);
    expect(isUserRejection(new Error('insufficient funds'))).toBe(false);
  });
});

describe('formatting', () => {
  it('formats and parses token amounts', () => {
    expect(formatAmount(CAP, 18, 0)).toBe('5,000,000');
    expect(formatAmount(parseEther('0.01'), 18, 6)).toBe('0.01');
    expect(formatAmount(123n, 18, 6)).toBe('0.000000000000000123');
    expect(parseAmount('0.01', 18)).toBe(parseEther('0.01'));
    expect(parseAmount('1,000', 18)).toBe(parseEther('1000'));
    expect(parseAmount('abc', 18)).toBeUndefined();
    expect(parseAmount('', 18)).toBeUndefined();
  });

  it('estimates the remaining time from blocks', () => {
    expect(approxDuration(7_001n, 12)).toBe('23 h 20 min');
    expect(approxDuration(4n, 12)).toBe('48 s');
  });

  it('keeps the walletAddChain parameters identical to the handoff', () => {
    expect(networkHandoff.walletAddChain.chainId).toBe('0xaa36a7');
  });
});
