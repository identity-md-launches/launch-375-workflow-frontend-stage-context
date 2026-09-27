import type { Deployment } from '../deployment';
import type { LaunchData } from '../hooks/useLaunch';
import { shortHash } from '../lib/format';

interface Props {
  deployment: Deployment;
  data: LaunchData;
}

export function ContractsCard({ deployment, data }: Props) {
  const explorer = deployment.network.explorer;
  const m = deployment.manifest;

  return (
    <section className="card" aria-labelledby="contracts-heading">
      <div className="card-head">
        <h2 id="contracts-heading">Contracts</h2>
      </div>
      <p className="lede">
        Addresses come from the deployment manifest this page loads at runtime. Each one is checked for bytecode on {deployment.network.name}{' '}
        before swaps are enabled.
      </p>
      <ul className="contract-list">
        {data.codes.map((c) => (
          <li key={c.address}>
            <span className="contract-name">{c.name}</span>
            <a href={`${explorer}/address/${c.address}`} target="_blank" rel="noreferrer" className="mono" translate="no">
              {c.address}
              <span className="sr-only"> (opens the explorer in a new tab)</span>
            </a>
            <span className={c.hasCode === undefined ? 'badge' : c.hasCode ? 'badge badge-active' : 'badge badge-danger'}>
              {c.hasCode === undefined ? 'Checking…' : c.hasCode ? 'Code found' : 'No code'}
            </span>
          </li>
        ))}
      </ul>
      <dl className="meta">
        <div>
          <dt>Launch ID</dt>
          <dd className="mono" translate="no">
            {m.launchId}
          </dd>
        </div>
        <div>
          <dt>Source commit</dt>
          <dd className="mono" translate="no">
            {m.sourceCommit}
          </dd>
        </div>
        <div>
          <dt>Attestation hash</dt>
          <dd className="mono" translate="no" title={m.attestationHash}>
            {shortHash(m.attestationHash, 16, 8)}
          </dd>
        </div>
        <div>
          <dt>Public RPCs</dt>
          <dd>
            <ul className="plain-list">
              {deployment.network.rpcUrls.map((u) => (
                <li key={u} className="mono" translate="no">
                  {u}
                </li>
              ))}
            </ul>
          </dd>
        </div>
        {deployment.network.faucets.length > 0 && (
          <div>
            <dt>Test {deployment.network.nativeCurrency.symbol} faucets</dt>
            <dd>
              <ul className="plain-list">
                {deployment.network.faucets.map((u) => (
                  <li key={u}>
                    <a href={u} target="_blank" rel="noreferrer">
                      {u.replace(/^https?:\/\//, '')}
                      <span className="sr-only"> (opens in a new tab)</span>
                    </a>
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        )}
      </dl>
    </section>
  );
}
