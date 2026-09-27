import type { Deployment } from '../deployment';
import type { LaunchData } from '../hooks/useLaunch';
import { feePercent, formatAmount, formatInteger, shortHash } from '../lib/format';
import { ethPerTokenWad, tokenPerEthWad } from '../lib/pool';

interface Props {
  deployment: Deployment;
  data: LaunchData;
}

export function PoolCard({ deployment, data }: Props) {
  const { pool, token, poolId, poolKey } = data;
  const native = deployment.network.nativeCurrency;
  const price = pool.sqrtPriceX96 !== undefined ? tokenPerEthWad(pool.sqrtPriceX96, native.decimals, token.decimals) : undefined;
  const inverse = price !== undefined ? ethPerTokenWad(price) : undefined;
  const explorer = deployment.network.explorer;

  return (
    <section className="card" aria-labelledby="pool-heading" aria-busy={pool.sqrtPriceX96 === undefined && data.readsLoading}>
      <div className="card-head">
        <h2 id="pool-heading">Pool</h2>
        {pool.initialized === false && <span className="badge badge-muted">Not initialized</span>}
      </div>
      <p className="lede">
        {native.symbol}/{token.symbol} Uniswap v4 pool read through StateView.
      </p>
      <dl className="stats">
        <div className="stat stat-wide">
          <dt>Price</dt>
          <dd className="num">
            {formatAmount(price, 18, 0)} <span className="unit">{token.symbol} per {native.symbol}</span>
          </dd>
        </div>
        <div className="stat stat-wide">
          <dt>Inverse</dt>
          <dd className="num">
            {formatAmount(inverse, 18, 12)} <span className="unit">{native.symbol} per {token.symbol}</span>
          </dd>
        </div>
        <div className="stat">
          <dt>Tick</dt>
          <dd className="num">{formatInteger(pool.tick)}</dd>
        </div>
        <div className="stat">
          <dt>LP fee</dt>
          <dd className="num">{pool.lpFee !== undefined ? feePercent(pool.lpFee) : '—'}</dd>
        </div>
        <div className="stat">
          <dt>Liquidity in range</dt>
          <dd className="num">{pool.liquidity !== undefined ? pool.liquidity.toString() : '—'}</dd>
        </div>
        <div className="stat">
          <dt>Tick spacing</dt>
          <dd className="num">{poolKey.tickSpacing}</dd>
        </div>
        <div className="stat stat-wide">
          <dt>Pool ID</dt>
          <dd>
            <code className="mono" title={poolId} translate="no">
              {shortHash(poolId, 14, 8)}
            </code>
          </dd>
        </div>
        <div className="stat stat-wide">
          <dt>Total supply</dt>
          <dd className="num">
            {formatAmount(token.totalSupply, token.decimals, 0)} <span className="unit">{token.symbol}</span>
          </dd>
        </div>
      </dl>
      <p className="fine">
        “Liquidity in range” is the active liquidity at the current tick. The launch seeds one-sided {token.symbol} above the initial price, so
        this reads 0 until the first buy moves the price into the seeded range; quotes still work. Hook address:{' '}
        <a href={`${explorer}/address/${poolKey.hooks}`} target="_blank" rel="noreferrer" translate="no">
          {shortHash(poolKey.hooks, 8, 6)}
          <span className="sr-only"> (opens the explorer in a new tab)</span>
        </a>
        .
      </p>
    </section>
  );
}
