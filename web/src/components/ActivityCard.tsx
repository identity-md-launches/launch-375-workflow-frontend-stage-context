import { READS } from '../config';
import type { Deployment } from '../deployment';
import type { LaunchData } from '../hooks/useLaunch';
import { formatAmount, formatInteger, shortAddress, shortHash } from '../lib/format';

interface Props {
  deployment: Deployment;
  data: LaunchData;
}

export function ActivityCard({ deployment, data }: Props) {
  const { events, token } = data;
  const explorer = deployment.network.explorer;
  const native = deployment.network.nativeCurrency;
  const swaps = events.swaps.slice(0, READS.maxSwapsShown);

  return (
    <section className="card" aria-labelledby="activity-heading" aria-busy={events.loading}>
      <div className="card-head">
        <h2 id="activity-heading">Activity</h2>
      </div>
      <p className="lede">Hook events and the pool’s swaps, read from public RPC logs.</p>
      {events.error && (
        <p className="notice notice-info" role="status">
          {events.error}
        </p>
      )}
      <h3>Cap window events</h3>
      {events.loading && events.capWindows.length === 0 ? (
        <p className="muted">Loading events…</p>
      ) : events.capWindows.length === 0 ? (
        <p className="muted">No CapWindowStarted event for this pool yet. The hook emits one when the pool initializes.</p>
      ) : (
        <ul className="event-list">
          {events.capWindows.map((e) => (
            <li key={e.transactionHash}>
              <span className="event-name">CapWindowStarted</span> at block <span className="num">{formatInteger(e.blockNumber)}</span>, cap ends at block{' '}
              <span className="num">{formatInteger(e.endBlock)}</span>.{' '}
              <a href={`${explorer}/tx/${e.transactionHash}`} target="_blank" rel="noreferrer" translate="no">
                Transaction {shortHash(e.transactionHash, 8, 6)}
                <span className="sr-only"> (opens the explorer in a new tab)</span>
              </a>
            </li>
          ))}
        </ul>
      )}
      <h3>Recent swaps</h3>
      {events.loading && swaps.length === 0 ? (
        <p className="muted">Loading swaps…</p>
      ) : swaps.length === 0 ? (
        <p className="muted">No swaps in this pool yet. The first buy will appear here after it confirms.</p>
      ) : (
        <div className="table-wrap">
          <table className="swaps">
            <caption className="sr-only">Most recent swaps in the pool, newest first</caption>
            <thead>
              <tr>
                <th scope="col">Block</th>
                <th scope="col">Side</th>
                <th scope="col" className="num-col">
                  {native.symbol}
                </th>
                <th scope="col" className="num-col">
                  {token.symbol}
                </th>
                <th scope="col">Sender</th>
                <th scope="col">Tx</th>
              </tr>
            </thead>
            <tbody>
              {swaps.map((s) => {
                // PoolManager deltas are from the pool's point of view: negative amount0 means ETH entered the pool (a buy).
                const isBuy = s.amount0 < 0n;
                return (
                  <tr key={`${s.transactionHash}-${s.blockNumber}`}>
                    <td className="num">{formatInteger(s.blockNumber)}</td>
                    <td>
                      <span className={isBuy ? 'badge badge-buy' : 'badge badge-sell'}>{isBuy ? 'Buy' : 'Sell'}</span>
                    </td>
                    <td className="num num-col">{formatAmount(s.amount0 < 0n ? -s.amount0 : s.amount0, native.decimals, 6)}</td>
                    <td className="num num-col">{formatAmount(s.amount1 < 0n ? -s.amount1 : s.amount1, token.decimals, 2)}</td>
                    <td>
                      <a href={`${explorer}/address/${s.sender}`} target="_blank" rel="noreferrer" translate="no" title={s.sender}>
                        {shortAddress(s.sender)}
                        <span className="sr-only"> (opens the explorer in a new tab)</span>
                      </a>
                    </td>
                    <td>
                      <a href={`${explorer}/tx/${s.transactionHash}`} target="_blank" rel="noreferrer" translate="no" title={s.transactionHash}>
                        {shortHash(s.transactionHash, 6, 4)}
                        <span className="sr-only"> (opens the explorer in a new tab)</span>
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="fine">
        Swap rows come from the PoolManager’s Swap event filtered by this pool ID; the sender is the router, not the visitor. Amounts are shown
        unsigned.
      </p>
    </section>
  );
}
