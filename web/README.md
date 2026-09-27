# Maxtx (MAXT) launch page

One static page for the Maxtx (MAXT) token and its MaxTxHook Uniswap v4 pool on Sepolia. It shows the
per-buy cap, whether the cap window is active, blocks left, the pool price (through Uniswap's
StateView), hook and pool events, and a buy/sell form that quotes through the v4 Quoter and swaps
through the Universal Router, warning before a buy the hook would revert.

The production export lives at the repository-root `dist/` and is committed. `dist/index.html` uses a
relative base, so it works from a gateway subpath, an ENS name or a plain directory with no server
rewrites.

## Configuration: one runtime source

The page has no hand-maintained address table. At startup it fetches `./imd-deployment.json`
(written into `dist/` by `scripts/build-manifest.mjs`), validates the schema, loads each contract's
ABI from the `abiPath` it names, and re-verifies the canonical Keccak-256 hash of that ABI against
the attested `abiHash`. Any mismatch stops the app before it enables reads or transactions.

| Value | Source |
| --- | --- |
| Chain id, name, public RPC URLs, explorer, native currency, faucets | `imd-deployment.json` → `network` (copied byte for byte from the handoff `handoff/network.json`) |
| Uniswap v4 PoolManager, Universal Router, Quoter, StateView, Permit2 | `imd-deployment.json` → `network.uniswapV4` |
| MAXT and MaxTxHook addresses and ABIs | `imd-deployment.json` → `contracts[]` and `dist/abi/*.json` |
| `wallet_addEthereumChain` parameters | derived from the `network` block in `src/deployment.ts` (`walletAddChainParams`) |
| Pool fee/tick spacing/paired currency, token metadata fallback, slippage and polling defaults | `src/config.ts` (values copied from the launch manifest `handoff/deployment.json` → `manifest.pool` / `manifest.token`) |

There are no private credentials anywhere: every RPC URL is a public endpoint from the network
block. Reads go through those URLs in order (JSON-RPC batched, first healthy one wins) with the
connected wallet's provider as a last fallback; signing always happens in the visitor's wallet.

### Wallets

Browser wallets are supported through EIP-1193 / EIP-6963 discovery (`injected` connector). No
WalletConnect project id was supplied, so no WalletConnect connector ships. To add one, install
`@walletconnect/ethereum-provider`, set `VITE_WALLETCONNECT_PROJECT_ID` at build time, and append
`walletConnect({ projectId })` from `wagmi/connectors` to the connector list in `src/wagmi.ts`.

When the wallet is on another chain the page shows a single "Switch to Sepolia" control. It requests
`wallet_switchEthereumChain`; if the wallet does not know the chain (error 4902 or an equivalent
message) it requests `wallet_addEthereumChain` with the parameters derived from the network block,
then switches again.

### Swaps

Exact-input swaps only. The page quotes with the Quoter's `quoteExactInputSingle` (a simulation),
applies the visitor's slippage to the quoted output, encodes `execute(commands, inputs, deadline)`
for the Universal Router (`V4_SWAP` → `SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL`), simulates that
call, and only then asks the wallet to sign. Buying sends ETH as the transaction value; selling first
walks two explicit approval steps (MAXT → Permit2, then Permit2 → Universal Router). Nested revert
data (`UnexpectedRevertBytes` → `WrappedError` → `CapExceeded`) is decoded so the cap warning names
the output the hook would have refused.

## Install, build, preview

Node 20+ and npm are required.

```sh
cd web
npm install                 # dependencies (node_modules is not committed)
npm run typecheck           # tsc for the app and for vite.config.ts
npm test                    # vitest: unit + interaction tests with a mocked wallet and RPC
npm run build               # vite build → ../dist, then scripts/build-manifest.mjs
npm run check-manifest      # verifies dist/imd-deployment.json matches the export byte for byte
npm run preview             # serves the export locally (vite preview)
npm run validate            # typecheck + test + build + check-manifest
```

`npm run build` empties and rewrites `../dist`, copies the pinned ABIs from `../docs/abi/` into
`dist/abi/`, verifies their hashes against `handoff/deployment.json`, and writes
`dist/imd-deployment.json` with the SHA-256 of every other exported file. Rebuild and commit `dist/`
together with any source change; the publisher pins the committed files without rebuilding.

`npm run dev` starts the Vite dev server, but note that `imd-deployment.json` and `dist/abi/` only
exist after a build; copy them into `web/public/` for dev-server use if needed (not committed).

## Validation

See `../docs/frontend-validation.md` for the build, typecheck, test and browser results, the Better
Interface review with findings and fixes, and the live-chain behaviour that was not exercised (no
real swap was broadcast). Screenshots from the scripted browser run are in
`../docs/validation/screenshots/`.

## Layout of this directory

```
web/
  handoff/            copies of the deployment and network handoff used by the manifest script
  scripts/            build-manifest.mjs
  src/
    config.ts         non-manifest constants (pool params, swap and polling defaults)
    deployment.ts     runtime manifest/ABI loader, schema validation, hash verification
    wagmi.ts          wagmi config built from the runtime deployment
    abi/uniswap.ts    Uniswap v4 periphery interface fragments
    lib/              pool key/id and price math, router encoding, revert decoding, formatting
    hooks/useLaunch.ts  all chain reads (hook views, StateView, token, events, code checks)
    components/       WalletControls, CapCard, PoolCard, SwapForm, ActivityCard, ContractsCard
    styles.css        design tokens and component styles (see ../docs/DESIGN.md)
    test/             fixtures: fake JSON-RPC backend and mock EIP-1193 wallet
```
