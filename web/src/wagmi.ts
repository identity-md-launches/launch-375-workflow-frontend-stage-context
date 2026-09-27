import { createConfig, fallback, http, unstable_connector, type Config, type Transport } from 'wagmi';
import { injected } from 'wagmi';
import type { EIP1193Provider } from 'viem';
import { READS } from './config';
import type { Deployment } from './deployment';

export interface AppConfigOptions {
  /** Test/injection hook: an explicit EIP-1193 provider to expose as the only wallet connector. */
  provider?: EIP1193Provider;
  /** Test/injection hook: replaces the public RPC transport. */
  transport?: Transport;
}

/**
 * Build the wagmi config from the runtime deployment. Reads go through the manifest's public RPC
 * list (JSON-RPC batched, first healthy URL wins) with the connected wallet's provider as the last
 * fallback; signing always stays with the visitor's wallet.
 */
export function createAppConfig(deployment: Deployment, options: AppConfigOptions = {}): Config {
  const chain = deployment.chain;
  const transport =
    options.transport ??
    fallback([
      ...deployment.network.rpcUrls.map((url) => http(url, { batch: true, retryCount: 2 })),
      unstable_connector(injected),
    ]);

  const connectors = options.provider
    ? [injected({ target: { id: 'test-wallet', name: 'Test wallet', provider: options.provider }, shimDisconnect: true })]
    : [injected({ shimDisconnect: true })];

  return createConfig({
    chains: [chain],
    connectors,
    transports: { [chain.id]: transport },
    multiInjectedProviderDiscovery: !options.provider,
    pollingInterval: READS.pollingIntervalMs,
    ssr: false,
  });
}
