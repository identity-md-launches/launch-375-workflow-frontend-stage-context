import { useEffect, useState } from 'react';
import { useAccount, useConnect, useDisconnect, useSwitchChain } from 'wagmi';
import type { EIP1193Provider } from 'viem';
import type { Deployment } from '../deployment';
import { describeError, isUserRejection } from '../lib/swap';
import { shortAddress } from '../lib/format';

interface Props {
  deployment: Deployment;
}

/**
 * A rejection that came from the wallet itself (EIP-1193 code 4001). wagmi also throws a synthetic
 * UserRejectedRequestError (code 4001, cause without a code) when a wallet adds a chain without
 * switching; that case must fall through to the explicit switch below, so only a provider-level
 * code counts.
 */
function rejectedByWallet(error: unknown): boolean {
  let root = error as { code?: number; cause?: unknown } | undefined;
  for (let depth = 0; root?.cause && typeof root.cause === 'object' && depth < 8; depth += 1) {
    root = root.cause as { code?: number; cause?: unknown };
  }
  return root?.code === 4001;
}

/** Errors that mean the wallet does not know the chain (EIP-3085 4902 or wallets that word it differently). */
function looksLikeUnknownChain(error: unknown): boolean {
  const e = error as { code?: number; cause?: { code?: number; data?: { originalError?: { code?: number } } }; message?: string };
  if (e?.code === 4902 || e?.cause?.code === 4902 || e?.cause?.data?.originalError?.code === 4902) return true;
  return /unrecognized chain|unknown chain|not added|chain.*not.*(supported|configured|found|added)|try adding the chain|wallet_addEthereumChain/i.test(e?.message ?? '');
}

export function WalletControls({ deployment }: Props) {
  const { address, connector, isConnected, chainId } = useAccount();
  const { connectors, connectAsync, isPending: connecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChainAsync } = useSwitchChain();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const targetChainId = deployment.chain.id;
  const wrongChain = isConnected && chainId !== targetChainId;
  const explorer = deployment.network.explorer;

  // Only offer connectors whose provider actually exists in this browser, and hide the generic
  // "Injected" entry when EIP-6963 discovery found named wallets.
  const [availableIds, setAvailableIds] = useState<string[]>();
  const connectorKey = connectors.map((c) => c.uid).join(',');
  useEffect(() => {
    let cancelled = false;
    Promise.all(connectors.map(async (c) => ((await c.getProvider().catch(() => undefined)) ? c.id : undefined))).then((ids) => {
      if (cancelled) return;
      const next = ids.filter((id): id is string => !!id);
      setAvailableIds((prev) => (prev && prev.join(',') === next.join(',') ? prev : next));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectorKey]);
  const available = connectors.filter((c) => availableIds?.includes(c.id));
  const named = available.filter((c) => c.id !== 'injected');
  const visibleConnectors = named.length > 0 ? named : available;

  const connect = async (id: string) => {
    setError(undefined);
    const c = connectors.find((x) => x.id === id);
    if (!c) return;
    try {
      await connectAsync({ connector: c });
    } catch (e) {
      setError(isUserRejection(e) ? 'Connection rejected in the wallet.' : describeError(e));
    }
  };

  /**
   * Switch the wallet to the launch chain. When the wallet does not know the chain (EIP-3326 error
   * 4902 or an equivalent message), request wallet_addEthereumChain with the exact parameters
   * derived from the manifest's network block, then switch again.
   */
  const switchOrAdd = async () => {
    setError(undefined);
    setBusy(true);
    const target = deployment.walletAddChain.chainId;
    try {
      try {
        await switchChainAsync({ chainId: targetChainId, addEthereumChainParameter: deployment.walletAddChain });
        return;
      } catch (e) {
        if (rejectedByWallet(e)) {
          setError('Network switch rejected in the wallet.');
          return;
        }
        // Anything else (unknown chain, or a wallet that added the chain without switching) falls
        // through to the explicit add-then-switch sequence below.
      }
      const provider = (await connector?.getProvider()) as EIP1193Provider | undefined;
      if (!provider) {
        setError('The wallet provider is unavailable. Reconnect and try again.');
        return;
      }
      const current = async () => String(await provider.request({ method: 'eth_chainId' })).toLowerCase();
      if ((await current()) === target) return;
      try {
        await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: target }] });
      } catch (e) {
        if (rejectedByWallet(e)) throw e;
        if (!looksLikeUnknownChain(e)) throw e;
        await provider.request({ method: 'wallet_addEthereumChain', params: [deployment.walletAddChain] } as never);
        if ((await current()) !== target) {
          await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: target }] });
        }
      }
    } catch (e) {
      setError(rejectedByWallet(e) ? 'Network change rejected in the wallet.' : describeError(e));
    } finally {
      setBusy(false);
    }
  };

  if (!isConnected) {
    return (
      <div className="wallet">
        {availableIds === undefined ? (
          <p className="wallet-note" role="status">
            Looking for a browser wallet…
          </p>
        ) : visibleConnectors.length === 0 ? (
          <p className="wallet-note">No browser wallet found. Install an EIP-1193 wallet extension, then reload this page.</p>
        ) : (
          <div className="wallet-actions">
            {visibleConnectors.map((c) => (
              <button key={c.uid} type="button" className="button button-primary" onClick={() => connect(c.id)} disabled={connecting} aria-busy={connecting}>
                {connecting ? 'Connecting…' : `Connect ${visibleConnectors.length > 1 ? c.name : 'wallet'}`}
              </button>
            ))}
          </div>
        )}
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="wallet">
      <div className="wallet-actions">
        <a className="address-chip" href={`${explorer}/address/${address}`} target="_blank" rel="noreferrer" title={address} translate="no">
          <span className="dot dot-ok" aria-hidden="true" /> {address ? shortAddress(address) : ''}
          <span className="sr-only"> (opens the explorer in a new tab)</span>
        </a>
        <button type="button" className="button button-secondary" onClick={() => disconnect()}>
          Disconnect
        </button>
      </div>
      {wrongChain && (
        <div className="notice notice-warn" role="alert">
          <p>
            <strong>Wrong network.</strong> The wallet is on chain {chainId ?? 'unknown'}. This launch lives on {deployment.network.name} (chain {targetChainId}).
          </p>
          <button type="button" className="button button-primary" onClick={switchOrAdd} disabled={busy} aria-busy={busy}>
            {busy ? 'Waiting for wallet…' : `Switch to ${deployment.network.name}`}
          </button>
        </div>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
