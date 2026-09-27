import { useEffect, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';
import { loadDeployment, type Deployment } from './deployment';
import { createAppConfig, type AppConfigOptions } from './wagmi';
import { useLaunch } from './hooks/useLaunch';
import { WalletControls } from './components/WalletControls';
import { CapCard } from './components/CapCard';
import { PoolCard } from './components/PoolCard';
import { SwapForm } from './components/SwapForm';
import { ActivityCard } from './components/ActivityCard';
import { ContractsCard } from './components/ContractsCard';

export interface AppProps {
  /** Test hook: replaces the runtime manifest loader. */
  loader?: () => Promise<Deployment>;
  /** Test hook: wallet provider / transport injection. */
  configOptions?: AppConfigOptions;
}

const defaultLoader = () => loadDeployment();

export function App({ loader = defaultLoader, configOptions }: AppProps) {
  const [deployment, setDeployment] = useState<Deployment>();
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(undefined);
    loader()
      .then((d) => {
        if (!cancelled) setDeployment(d);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [loader, attempt]);

  const config = useMemo(() => (deployment ? createAppConfig(deployment, configOptions) : undefined), [deployment, configOptions]);
  const queryClient = useMemo(() => new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } }), []);

  if (error) {
    return (
      <main id="main" className="page page-center">
        <div className="card" role="alert">
          <h1>Deployment configuration unavailable</h1>
          <p>{error}</p>
          <p className="muted">
            The page refuses to enable any reads or transactions when <code>imd-deployment.json</code> or an ABI is missing or does not match its
            attested hash.
          </p>
          <button type="button" className="button button-primary" onClick={() => setAttempt((n) => n + 1)}>
            Retry
          </button>
        </div>
      </main>
    );
  }

  if (!deployment || !config) {
    return (
      <main id="main" className="page page-center" aria-busy="true">
        <p role="status">Loading deployment configuration…</p>
      </main>
    );
  }

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <Page deployment={deployment} />
      </QueryClientProvider>
    </WagmiProvider>
  );
}

function Page({ deployment }: { deployment: Deployment }) {
  const data = useLaunch(deployment);
  const symbol = data.token.symbol;

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="page-header">
        <div className="page-header-inner">
          <div className="title-block">
            <p className="eyebrow">
              {deployment.network.name}
              {deployment.network.testnet ? ' testnet' : ''} · Uniswap v4 hook launch
            </p>
            <h1>
              {data.token.name} <span className="ticker" translate="no">({symbol})</span>
            </h1>
            <p className="subtitle">
              Buy and sell {symbol} in its native-{deployment.network.nativeCurrency.symbol} pool. MaxTxHook caps every single buy for the pool’s first{' '}
              {data.hook.windowBlocks !== undefined ? data.hook.windowBlocks.toLocaleString('en-US') : '7,200'} blocks.
            </p>
          </div>
          <WalletControls deployment={deployment} />
        </div>
      </header>
      <main id="main" className="page">
        {data.readsError && (
          <p className="notice notice-warn" role="alert">
            {data.readsError}
          </p>
        )}
        <div className="grid">
          <div className="col">
            <CapCard deployment={deployment} data={data} />
            <PoolCard deployment={deployment} data={data} />
          </div>
          <div className="col">
            <SwapForm deployment={deployment} data={data} />
          </div>
        </div>
        <ActivityCard deployment={deployment} data={data} />
        <ContractsCard deployment={deployment} data={data} />
      </main>
      <footer className="page-footer">
        <p>
          Static page. Reads use the public RPCs listed above; signing stays in your wallet. Nothing here is financial advice, and {symbol} is a
          testnet token.
        </p>
      </footer>
    </>
  );
}
