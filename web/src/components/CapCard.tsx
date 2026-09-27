import { READS } from '../config';
import type { Deployment } from '../deployment';
import type { LaunchData } from '../hooks/useLaunch';
import { approxDuration, formatAmount, formatInteger } from '../lib/format';

interface Props {
  deployment: Deployment;
  data: LaunchData;
}

export function CapCard({ deployment, data }: Props) {
  const { hook, token, blockNumber, events } = data;
  const active = hook.isCapActive;
  const windowStart = events.capWindows[0];
  const explorer = deployment.network.explorer;
  const loading = hook.cap === undefined && data.readsLoading;

  let statusLabel = 'Loading…';
  let statusClass = 'badge';
  if (active === true) {
    statusLabel = 'Active';
    statusClass = 'badge badge-active';
  } else if (active === false) {
    statusLabel = hook.endBlock && hook.endBlock > 0n ? 'Expired' : 'Not started';
    statusClass = 'badge badge-muted';
  }

  return (
    <section className="card" aria-labelledby="cap-heading" aria-busy={loading}>
      <div className="card-head">
        <h2 id="cap-heading">Buy cap</h2>
        <span className={statusClass}>
          <span className="dot" aria-hidden="true" /> {statusLabel}
        </span>
      </div>
      <p className="lede">
        {active === true
          ? `Each buy may deliver at most ${formatAmount(hook.cap, token.decimals, 0)} ${token.symbol} while the cap window is open. Sells are never capped.`
          : active === false
            ? `The cap window has ended. Buys of any size are allowed. Sells were never capped.`
            : 'Reading the cap from the hook…'}
      </p>
      <dl className="stats">
        <div className="stat">
          <dt>Cap per buy</dt>
          <dd className="num">
            {formatAmount(hook.cap, token.decimals, 0)} <span className="unit">{token.symbol}</span>
          </dd>
        </div>
        <div className="stat">
          <dt>Blocks left</dt>
          <dd className="num">
            {formatInteger(hook.blocksRemaining)}
            {hook.blocksRemaining !== undefined && hook.blocksRemaining > 0n && (
              <span className="unit"> ≈ {approxDuration(hook.blocksRemaining, READS.approxBlockSeconds)}</span>
            )}
          </dd>
        </div>
        <div className="stat">
          <dt>Cap ends at block</dt>
          <dd className="num">{formatInteger(hook.endBlock)}</dd>
        </div>
        <div className="stat">
          <dt>Current block</dt>
          <dd className="num">{formatInteger(blockNumber)}</dd>
        </div>
        <div className="stat">
          <dt>Window length</dt>
          <dd className="num">
            {formatInteger(hook.windowBlocks)} <span className="unit">blocks</span>
          </dd>
        </div>
        <div className="stat">
          <dt>Window started</dt>
          <dd className="num">
            {windowStart ? (
              <a href={`${explorer}/tx/${windowStart.transactionHash}`} target="_blank" rel="noreferrer">
                block {formatInteger(windowStart.blockNumber)}
                <span className="sr-only"> (CapWindowStarted transaction, opens the explorer in a new tab)</span>
              </a>
            ) : events.loading ? (
              'Loading…'
            ) : (
              'No CapWindowStarted event found'
            )}
          </dd>
        </div>
      </dl>
      <p className="fine">
        The cap is per swap. Several swaps, even in one transaction, get around it: it slows single large buys and does not stop a determined
        buyer. Expiry happens without a transaction when the chain reaches the end block.
      </p>
    </section>
  );
}
