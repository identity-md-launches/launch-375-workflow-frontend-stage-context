import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useAccount, usePublicClient, useWalletClient } from 'wagmi';
import type { Hex } from 'viem';
import { erc20Abi, permit2Abi, quoterAbi, universalRouterAbi } from '../abi/uniswap';
import { SWAP } from '../config';
import type { Deployment } from '../deployment';
import type { LaunchData } from '../hooks/useLaunch';
import { formatAmount, parseAmount } from '../lib/format';
import { applySlippage } from '../lib/pool';
import { decodeRevertData, describeError, encodeUniversalRouterSwap, isUserRejection, revertDataOf, type DecodedRevert } from '../lib/swap';

interface Props {
  deployment: Deployment;
  data: LaunchData;
}

type Side = 'buy' | 'sell';

interface QuoteState {
  status: 'idle' | 'loading' | 'ok' | 'error';
  amountIn?: bigint;
  side?: Side;
  amountOut?: bigint;
  gasEstimate?: bigint;
  revert?: DecodedRevert;
  message?: string;
}

type Step = 'idle' | 'approve-token' | 'approve-permit2' | 'simulate' | 'sign' | 'pending' | 'confirmed' | 'failed';

interface TxState {
  step: Step;
  label?: string;
  hash?: Hex;
  error?: string;
  action?: 'approve-token' | 'approve-permit2' | 'swap';
}

const MAX_UINT160 = (1n << 160n) - 1n;
const GAS_MARGIN_WEI = 2_000_000_000_000_000n; // 0.002 ETH kept back when filling "Max" for a buy

export function SwapForm({ deployment, data }: Props) {
  const { network, hook, chain } = deployment;
  const uni = network.uniswapV4;
  const native = network.nativeCurrency;
  const { token, poolKey, account, allCodeVerified, codesReady, pool } = data;
  const { address, isConnected, chainId } = useAccount();
  const publicClient = usePublicClient({ chainId: chain.id });
  const { data: walletClient } = useWalletClient({ chainId: chain.id });

  const [side, setSide] = useState<Side>('buy');
  const [amountText, setAmountText] = useState('');
  const [slippageText, setSlippageText] = useState(String(SWAP.defaultSlippagePercent));
  const [amountError, setAmountError] = useState<string>();
  const [slippageError, setSlippageError] = useState<string>();
  const [quote, setQuote] = useState<QuoteState>({ status: 'idle' });
  const [tx, setTx] = useState<TxState>({ step: 'idle' });
  const amountRef = useRef<HTMLInputElement>(null);
  const slippageRef = useRef<HTMLInputElement>(null);
  const quoteSeq = useRef(0);
  const ids = { amount: useId(), slippage: useId(), amountHelp: useId(), amountErr: useId(), slippageErr: useId(), quote: useId() };

  const inDecimals = side === 'buy' ? native.decimals : token.decimals;
  const outDecimals = side === 'buy' ? token.decimals : native.decimals;
  const inSymbol = side === 'buy' ? native.symbol : token.symbol;
  const outSymbol = side === 'buy' ? token.symbol : native.symbol;
  const amountIn = parseAmount(amountText, inDecimals);
  const slippage = Number(slippageText.trim());
  const slippageValid = slippageText.trim() !== '' && Number.isFinite(slippage) && slippage >= 0 && slippage <= SWAP.maxSlippagePercent;
  const balanceIn = side === 'buy' ? account.ethBalance : account.tokenBalance;
  const wrongChain = isConnected && chainId !== chain.id;
  const busy = tx.step === 'approve-token' || tx.step === 'approve-permit2' || tx.step === 'simulate' || tx.step === 'sign' || tx.step === 'pending';

  // Quote the exact-input swap through the v4 Quoter (a simulation, never a transaction).
  useEffect(() => {
    if (!publicClient || amountIn === undefined || amountIn === 0n) {
      setQuote({ status: 'idle' });
      return;
    }
    const seq = ++quoteSeq.current;
    setQuote((q) => ({ ...q, status: 'loading' }));
    const timer = setTimeout(async () => {
      try {
        const { result } = await publicClient.simulateContract({
          address: uni.quoter,
          abi: quoterAbi,
          functionName: 'quoteExactInputSingle',
          args: [{ poolKey, zeroForOne: side === 'buy', exactAmount: amountIn, hookData: '0x' }],
        });
        if (seq !== quoteSeq.current) return;
        setQuote({ status: 'ok', amountIn, side, amountOut: result[0], gasEstimate: result[1] });
      } catch (error) {
        if (seq !== quoteSeq.current) return;
        const raw = revertDataOf(error);
        if (raw) {
          const revert = decodeRevertData(raw, hook.abi, token.symbol, (v) => formatAmount(v, token.decimals, 0));
          const message =
            revert.kind === 'notEnoughLiquidity' && side === 'sell'
              ? `The pool cannot fill this sell: it does not hold enough ${native.symbol} yet. Sells become possible once buys have added ${native.symbol} to the pool.`
              : revert.message;
          setQuote({ status: 'error', amountIn, side, revert, message });
        } else {
          setQuote({ status: 'error', amountIn, side, message: `Unable to get a quote: ${describeError(error)}` });
        }
      }
    }, SWAP.quoteDebounceMs);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicClient, amountIn, side, uni.quoter, poolKey, hook.abi, token.symbol, token.decimals, data.blockNumber]);

  // A quote stays usable while a periodic refresh for the same amount is loading; the router call is
  // simulated again immediately before signing, so a slightly stale quote can never over-promise.
  const quoteFresh = quote.status !== 'error' && quote.amountOut !== undefined && quote.amountIn === amountIn && quote.side === side;
  const minOut = quoteFresh && slippageValid ? applySlippage(quote.amountOut!, slippage) : undefined;
  const capActive = data.hook.isCapActive === true;
  const cap = data.hook.cap;
  const wouldRevertCap = side === 'buy' && quote.status === 'error' && quote.revert?.kind === 'capExceeded' && quote.amountIn === amountIn;
  const overCapByQuote = side === 'buy' && capActive && quoteFresh && cap !== undefined && quote.amountOut! > cap;
  const nearCap = side === 'buy' && capActive && quoteFresh && cap !== undefined && !overCapByQuote && quote.amountOut! * 10n > cap * 9n;
  const suggestedMax =
    wouldRevertCap && quote.revert?.cap && quote.revert.requested && amountIn ? (amountIn * quote.revert.cap) / quote.revert.requested : undefined;

  const needsTokenApproval = side === 'sell' && amountIn !== undefined && (account.permit2Allowance ?? 0n) < amountIn;
  const nowSec = Math.floor(Date.now() / 1000);
  const needsPermit2Approval =
    side === 'sell' && amountIn !== undefined && (!account.routerAllowance || account.routerAllowance.amount < amountIn || account.routerAllowance.expiration <= nowSec);

  // Hard prerequisites keep the transaction control disabled; the reason is always written next to it.
  let blockedReason: string | undefined;
  if (!isConnected) blockedReason = 'Connect a wallet to swap.';
  else if (wrongChain) blockedReason = `Switch the wallet to ${network.name} to swap.`;
  else if (!codesReady) blockedReason = 'Checking that the router and contracts have code…';
  else if (!allCodeVerified) blockedReason = 'A required contract has no code on this chain, so swaps stay disabled.';
  else if (pool.initialized === false) blockedReason = 'The pool is not initialized, so there is nothing to swap against.';
  else if (wouldRevertCap || overCapByQuote) blockedReason = 'This buy is above the cap and would revert. Reduce the amount.';
  else if (busy) blockedReason = undefined;

  const nextAction: 'approve-token' | 'approve-permit2' | 'swap' = needsTokenApproval ? 'approve-token' : needsPermit2Approval ? 'approve-permit2' : 'swap';
  const submitLabel =
    nextAction === 'approve-token'
      ? `Approve ${token.symbol} for Permit2`
      : nextAction === 'approve-permit2'
        ? 'Approve the router'
        : side === 'buy'
          ? `Buy ${token.symbol}`
          : `Sell ${token.symbol}`;

  const fillMax = () => {
    if (balanceIn === undefined) return;
    const v = side === 'buy' ? (balanceIn > GAS_MARGIN_WEI ? balanceIn - GAS_MARGIN_WEI : 0n) : balanceIn;
    setAmountText(formatAmountPlain(v, inDecimals));
    setAmountError(undefined);
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || blockedReason || !publicClient || !walletClient || !address) return;
    // Validate on submit and focus the first invalid field.
    if (amountIn === undefined || amountIn === 0n) {
      setAmountError(`Enter how much ${inSymbol} to ${side === 'buy' ? 'spend' : 'sell'}, for example 0.01.`);
      amountRef.current?.focus();
      return;
    }
    if (balanceIn !== undefined && amountIn > balanceIn) {
      setAmountError(`Enter at most ${formatAmount(balanceIn, inDecimals, 6)} ${inSymbol}, your current balance.`);
      amountRef.current?.focus();
      return;
    }
    if (!slippageValid) {
      setSlippageError(`Enter a slippage tolerance between 0 and ${SWAP.maxSlippagePercent}, for example 0.5.`);
      slippageRef.current?.focus();
      return;
    }
    setAmountError(undefined);
    setSlippageError(undefined);

    try {
      if (nextAction === 'approve-token') {
        await runTx('approve-token', 'Approving the token for Permit2', async () => {
          const { request } = await publicClient.simulateContract({ account: address, address: deployment.token.address, abi: erc20Abi, functionName: 'approve', args: [uni.permit2, amountIn] });
          return walletClient.writeContract(request);
        });
        return;
      }
      if (nextAction === 'approve-permit2') {
        const expiration = nowSec + SWAP.permit2ExpirationSeconds;
        const amount = amountIn > MAX_UINT160 ? MAX_UINT160 : amountIn;
        await runTx('approve-permit2', 'Approving the Universal Router in Permit2', async () => {
          const { request } = await publicClient.simulateContract({ account: address, address: uni.permit2, abi: permit2Abi, functionName: 'approve', args: [deployment.token.address, uni.universalRouter, amount, expiration] });
          return walletClient.writeContract(request);
        });
        return;
      }
      if (!quoteFresh || minOut === undefined) {
        setTx({ step: 'failed', action: 'swap', error: 'No fresh quote. Wait for the quote to load, then try again.' });
        return;
      }
      const deadline = BigInt(nowSec + SWAP.deadlineSeconds);
      const call = encodeUniversalRouterSwap({ key: poolKey, zeroForOne: side === 'buy', amountIn, amountOutMinimum: minOut, deadline });
      await runTx('swap', side === 'buy' ? `Buying ${token.symbol}` : `Selling ${token.symbol}`, async () => {
        const { request } = await publicClient.simulateContract({
          account: address,
          address: uni.universalRouter,
          abi: universalRouterAbi,
          functionName: 'execute',
          args: [call.commands, call.inputs, call.deadline],
          value: call.value,
        });
        return walletClient.writeContract(request);
      });
    } catch {
      // runTx already recorded the failure.
    }
  };

  async function runTx(action: 'approve-token' | 'approve-permit2' | 'swap', label: string, send: () => Promise<Hex>) {
    setTx({ step: 'simulate', action, label });
    let hash: Hex;
    try {
      // simulateContract runs first inside `send`; a revert surfaces here with its decoded reason.
      setTx({ step: 'sign', action, label });
      hash = await send();
    } catch (error) {
      const raw = revertDataOf(error);
      const message = isUserRejection(error)
        ? 'Request rejected in the wallet. Nothing was sent.'
        : raw
          ? decodeRevertData(raw, hook.abi, token.symbol, (v) => formatAmount(v, token.decimals, 0)).message
          : describeError(error);
      setTx({ step: 'failed', action, label, error: message });
      throw error;
    }
    setTx({ step: 'pending', action, label, hash });
    try {
      const receipt = await publicClient!.waitForTransactionReceipt({ hash });
      if (receipt.status === 'success') {
        setTx({ step: 'confirmed', action, label, hash });
      } else {
        setTx({ step: 'failed', action, label, hash, error: 'The transaction reverted on chain. Refresh the quote and try again.' });
      }
    } catch (error) {
      setTx({ step: 'failed', action, label, hash, error: describeError(error) });
    } finally {
      data.refetchAccount();
      data.refetchReads();
    }
  }

  const stepStatus = (id: 'approve-token' | 'approve-permit2' | 'swap', needed: boolean) => {
    if (tx.action === id && tx.step === 'confirmed') return 'Done';
    if (tx.action === id && (tx.step === 'sign' || tx.step === 'pending' || tx.step === 'simulate')) return 'In progress';
    if (!needed) return 'Done';
    return nextAction === id ? 'Next' : 'Pending';
  };

  return (
    <section className="card card-swap" aria-labelledby="swap-heading">
      <div className="card-head">
        <h2 id="swap-heading">Swap</h2>
      </div>
      <p className="lede">
        Exact-input swaps through the Uniswap Universal Router. The page quotes the output first and warns before a buy that the cap would
        revert.
      </p>
      <form onSubmit={onSubmit} noValidate>
        <fieldset className="segmented">
          <legend className="label">Side</legend>
          <label className={side === 'buy' ? 'seg seg-on' : 'seg'}>
            <input type="radio" name="side" value="buy" checked={side === 'buy'} onChange={() => switchSide('buy')} disabled={busy} />
            Buy {token.symbol}
          </label>
          <label className={side === 'sell' ? 'seg seg-on' : 'seg'}>
            <input type="radio" name="side" value="sell" checked={side === 'sell'} onChange={() => switchSide('sell')} disabled={busy} />
            Sell {token.symbol}
          </label>
        </fieldset>

        <div className="field">
          <div className="field-row">
            <label htmlFor={ids.amount} className="label">
              {side === 'buy' ? `You pay (${native.symbol})` : `You sell (${token.symbol})`}
            </label>
            {isConnected && !wrongChain && (
              <span className="field-aside num">
                Balance {formatAmount(balanceIn, inDecimals, 6)} {inSymbol}{' '}
                <button type="button" className="link-button" onClick={fillMax} disabled={busy || balanceIn === undefined}>
                  Max
                </button>
              </span>
            )}
          </div>
          <input
            ref={amountRef}
            id={ids.amount}
            className="input num"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            placeholder="0.01"
            value={amountText}
            onChange={(e) => {
              setAmountText(e.target.value);
              setAmountError(undefined);
            }}
            aria-invalid={amountError ? true : undefined}
            aria-describedby={amountError ? `${ids.amountErr} ${ids.amountHelp}` : ids.amountHelp}
            disabled={busy}
          />
          <p id={ids.amountHelp} className="help">
            {side === 'buy' ? `${native.symbol} is sent as the transaction value; no approval is needed.` : `Selling needs two approvals first: ${token.symbol} → Permit2, then Permit2 → router.`}
          </p>
          {amountError && (
            <p id={ids.amountErr} className="inline-error">
              {amountError}
            </p>
          )}
        </div>

        <div className="field field-small">
          <label htmlFor={ids.slippage} className="label">
            Slippage tolerance (%)
          </label>
          <input
            ref={slippageRef}
            id={ids.slippage}
            className="input num"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={slippageText}
            onChange={(e) => {
              setSlippageText(e.target.value);
              setSlippageError(undefined);
            }}
            aria-invalid={slippageError ? true : undefined}
            aria-describedby={slippageError ? ids.slippageErr : undefined}
            disabled={busy}
          />
          {slippageError && (
            <p id={ids.slippageErr} className="inline-error">
              {slippageError}
            </p>
          )}
        </div>

        <div className="quote" id={ids.quote} role="status" aria-live="polite" aria-atomic="true">
          {quote.status === 'idle' && <p className="muted">Enter an amount to see a quote.</p>}
          {quote.status === 'loading' && !quoteFresh && <p className="muted">Getting a quote…</p>}
          {quoteFresh && (
            <dl className="quote-grid">
              <div>
                <dt>You receive (estimated)</dt>
                <dd className="num">
                  {formatAmount(quote.amountOut, outDecimals, side === 'buy' ? 2 : 6)} <span className="unit">{outSymbol}</span>
                </dd>
              </div>
              <div>
                <dt>Minimum after {slippageValid ? slippage : '?'}% slippage</dt>
                <dd className="num">
                  {formatAmount(minOut, outDecimals, side === 'buy' ? 2 : 6)} <span className="unit">{outSymbol}</span>
                </dd>
              </div>
              <div>
                <dt>Rate</dt>
                <dd className="num">
                  1 {inSymbol} ≈ {formatAmount(rate(quote.amountOut!, amountIn!, outDecimals, inDecimals), 18, side === 'buy' ? 0 : 10)} {outSymbol}
                </dd>
              </div>
              {quote.status === 'loading' && <p className="muted">Refreshing quote…</p>}
            </dl>
          )}
          {quote.status === 'error' && quote.amountIn === amountIn && !wouldRevertCap && <p className="inline-error">{quote.message}</p>}
          {wouldRevertCap && <p className="muted">No quote: the hook would revert this buy. Details below.</p>}
        </div>

        {wouldRevertCap && (
          <div className="notice notice-danger" role="alert">
            <p>
              <strong>This buy would revert.</strong> {quote.revert?.message}
            </p>
            {suggestedMax !== undefined && (
              <p>
                Roughly {formatAmount(suggestedMax, inDecimals, 6)} {inSymbol} or less would stay under the cap at the current price (an
                estimate: price impact is not linear).
              </p>
            )}
          </div>
        )}
        {overCapByQuote && (
          <div className="notice notice-danger" role="alert">
            <p>
              <strong>This buy would revert.</strong> The quoted output is above the {formatAmount(cap, token.decimals, 0)} {token.symbol} cap.
            </p>
          </div>
        )}
        {nearCap && (
          <div className="notice notice-warn" role="status">
            <p>
              <strong>Close to the cap.</strong> The quote is within 10% of the {formatAmount(cap, token.decimals, 0)} {token.symbol} per-buy cap. If the
              price moves before your transaction mines, the hook may revert it.
            </p>
          </div>
        )}

        {side === 'sell' && isConnected && !wrongChain && (
          <ol className="steps" aria-label="Steps to sell">
            <li>
              <span className="step-name">Approve {token.symbol} for Permit2</span>
              <span className="step-state">{stepStatus('approve-token', needsTokenApproval)}</span>
            </li>
            <li>
              <span className="step-name">Approve the Universal Router in Permit2</span>
              <span className="step-state">{stepStatus('approve-permit2', needsPermit2Approval)}</span>
            </li>
            <li>
              <span className="step-name">Sell {token.symbol}</span>
              <span className="step-state">{stepStatus('swap', true)}</span>
            </li>
          </ol>
        )}

        <div className="submit-row">
          <button type="submit" className="button button-primary button-large" disabled={!!blockedReason || busy} aria-busy={busy}>
            {busy ? `${submitLabel}…` : submitLabel}
          </button>
          {blockedReason && <p className="help">{blockedReason}</p>}
          {!blockedReason && !busy && nextAction === 'swap' && (
            <p className="help">
              Sends {amountIn !== undefined ? formatAmount(amountIn, inDecimals, 6) : '…'} {inSymbol} to the Universal Router. The transaction is
              simulated first; the wallet asks for one signature.
            </p>
          )}
        </div>

        <div className="tx-status" role="status" aria-live="polite" aria-atomic="true">
          {tx.step === 'simulate' && <p>{tx.label}: simulating…</p>}
          {tx.step === 'sign' && <p>{tx.label}: waiting for the wallet to sign.</p>}
          {tx.step === 'pending' && (
            <p>
              {tx.label}: pending on chain. <TxLink hash={tx.hash} explorer={network.explorer} />
            </p>
          )}
          {tx.step === 'confirmed' && (
            <p className="ok">
              {tx.label}: confirmed. <TxLink hash={tx.hash} explorer={network.explorer} />
            </p>
          )}
        </div>
        {tx.step === 'failed' && (
          <div className="notice notice-danger" role="alert">
            <p>
              <strong>{tx.label ? `${tx.label} failed.` : 'Failed.'}</strong> {tx.error} <TxLink hash={tx.hash} explorer={network.explorer} />
            </p>
          </div>
        )}
      </form>
    </section>
  );

  function switchSide(next: Side) {
    setSide(next);
    setAmountError(undefined);
    setQuote({ status: 'idle' });
    setTx({ step: 'idle' });
  }
}

function TxLink({ hash, explorer }: { hash?: Hex; explorer: string }) {
  if (!hash) return null;
  return (
    <a href={`${explorer}/tx/${hash}`} target="_blank" rel="noreferrer" translate="no">
      View transaction {hash.slice(0, 10)}…
      <span className="sr-only"> (opens the explorer in a new tab)</span>
    </a>
  );
}

/** amountOut per 1 unit of input, as an 18-decimal fixed-point value. */
function rate(amountOut: bigint, amountIn: bigint, outDecimals: number, inDecimals: number): bigint {
  if (amountIn === 0n) return 0n;
  return (amountOut * 10n ** BigInt(inDecimals) * 10n ** 18n) / (amountIn * 10n ** BigInt(outDecimals));
}

/** Plain decimal string (no grouping) suitable for putting back into the input. */
function formatAmountPlain(value: bigint, decimals: number): string {
  const s = value.toString().padStart(decimals + 1, '0');
  const whole = s.slice(0, s.length - decimals);
  const frac = s.slice(s.length - decimals).replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole;
}
