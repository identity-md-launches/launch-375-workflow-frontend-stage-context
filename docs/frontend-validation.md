# Frontend validation record

Worker-side validation of the Maxtx (MAXT) launch page (`web/` source, `dist/` export). This is the
worker's report, not an independent network certification. Publication checks (CID, named entrypoint,
asset hashes, RPC chain id, contract code) run later and do not execute browser JavaScript.

## 1. Scope and assumptions

- Product: one static page (`dist/index.html`) that reads MaxTxHook views and events, the pool price
  through Uniswap's Sepolia StateView, and offers a buy/sell form with quotes and a pre-swap cap warning.
- Stack: Vite 7, React 19, TypeScript 5.9, wagmi 2 + viem 2, vitest 3. Static export with base `./`.
- Runtime configuration: `dist/imd-deployment.json` (schema `{version, launchId, chainId, sourceCommit,
  attestationHash, contracts[], assets[], network}`) is the only source of chain, addresses, ABIs and
  public RPC URLs. Verified against `.imd/reads/deployment.json` and `.imd/reads/network.json`: launch
  id, chain id, source commit, attestation hash and the contract set/addresses/abiHashes are copied;
  the `network` block is byte-identical; all 6 asset SHA-256 values match the exported bytes.
- ABI hashes: the handoff `abiHash` equals keccak256 of the ABI serialized with sorted keys and no
  whitespace. Both `docs/abi/MAXT.json` and `docs/abi/MaxTxHook.json` at source commit `532fff9`
  match. The build script refuses a mismatch and the app re-verifies the hash at runtime.
- Router choice: `.imd/reads/workflow.md` mentions Uniswap's PoolSwapTest router; the assignment's
  acceptance criteria require every swap, quote and approval to use the addresses in the network block
  and forbid hard-coding any router. The page therefore swaps through the network block's Universal
  Router (`0x3a9d…f98b`), quotes through its V4 Quoter and approves through its Permit2, and checks
  that each of these plus PoolManager, StateView, MAXT and MaxTxHook has bytecode before enabling
  swaps (7 × "Code found" in the Contracts card).
- Pool key: currency0 = native ETH, currency1 = MAXT, fee 3000, tickSpacing 60, hooks = MaxTxHook.
  PoolId `0x556b91ec…74a0f7` confirmed live: `endBlock(poolId) = 11,798,676`, `isCapActive = true`,
  StateView `getSlot0` returns a nonzero price, and the `CapWindowStarted` log exists at block
  11,791,476 (`test/scratch/probe.mjs`, run 2026-09-27).
- `DESIGN.md`: the acceptance criteria ask for a repository-root file, but the assignment's write scope
  is limited to `web/**`, `dist/**`, `docs/**`; the design document is therefore at `docs/DESIGN.md`.

## 2. Commands and outcomes (final source)

| Command (in `web/`) | Result |
| --- | --- |
| `npm install` | 725 packages, no vulnerabilities blocking; `node_modules` not committed |
| `npx tsc -p tsconfig.json --noEmit` and `-p tsconfig.node.json` | exit 0 |
| `npx vitest run` | 3 files, 29 tests passed (32 s) |
| `npx vite build` | `dist/index.html` 0.94 kB, CSS 13 kB, JS 634 kB (+2.9 kB ccip chunk) |
| `node scripts/build-manifest.mjs` | ABI hashes verified, `dist/imd-deployment.json` written: 6 assets, 661,213 bytes |
| `node scripts/build-manifest.mjs --check` | `manifest OK` |
| `node test/scratch/browser-check.mjs` | `BROWSER CHECK OK`, 10 scenarios, 0 console errors, 0 failed requests |

Export size is far below the 8 MiB per-file and 128-asset limits and below half the checker's 64 MiB
budget.

### Tests (`web/src/**/*.test.ts(x)`)

- `lib/lib.test.ts`: pool key/id equals the live pool id; price math from the manifest sqrtPriceX96;
  Universal Router `execute` encoding (commands `0x10`, actions `0x060c0f`, three params, ETH value
  for buys, none for sells) decoded back with viem; nested revert decoding of the real Sepolia quoter
  revert (`UnexpectedRevertBytes → WrappedError → CapExceeded(5,000,000 MAXT, 46,731,075 MAXT)`) and
  synthetic chains; router slippage/deadline errors; wallet rejection detection; formatting.
- `deployment.test.ts`: manifest schema validation (unsafe `../`, absolute and URL paths rejected,
  chain mismatch, non-https RPC); canonical ABI hash equals the handoff for both contracts;
  `wallet_addEthereumChain` parameters derived from the network block equal the handoff's
  `walletAddChain`; runtime loader with mocked `fetch` loads relative to the page and refuses a tampered
  ABI and a missing manifest.
- `App.test.tsx` (mock EIP-1193 wallet + fake JSON-RPC backend, no network): reads without a wallet
  (cap 5,000,000, Active, blocks left, price 100,000,000 MAXT/ETH, 7 code checks, CapWindowStarted and
  a Swap row); wrong chain → "Switch to Sepolia" → `wallet_switchEthereumChain` fails 4902 →
  `wallet_addEthereumChain` with the exact handoff parameters → switch again; disconnect; buy quote,
  slippage minimum, simulate, sign, pending, confirmed with explorer link and correct calldata/value;
  CapExceeded warning with disabled control and suggested maximum; no warning after expiry; submit
  validation (focus + `aria-invalid`), balance validation and wallet rejection message; sell approval
  steps (ERC-20 `approve(permit2, amount)`, Permit2 `approve(token, router, amount, expiration)`, then
  the swap with zero value).

## 3. Browser inspection (finished export)

No IMD preview launcher (`test/scratch/browser/preview.json`) exists on this worker and the MCP
browser's code-execution tool is not permitted, so the export was inspected with a bounded foreground
script (`test/scratch/browser-check.mjs`) using the installed `playwright-core` and Chromium 1246: it
serves `dist/` under a `/preview/` subpath on an ephemeral port, drives headless Chromium, writes the
report and screenshots, and exits. Reads in these runs went to the live Sepolia public RPCs; the
wallet was a mock EIP-1193 provider injected by the script (forwarding reads to the RPC, refusing
`eth_sendTransaction` with code 4001). Report: `docs/validation/browser-report.json`.

| Scenario | Viewport | Evidence |
| --- | --- | --- |
| No wallet, live reads: cap Active, 6,7xx blocks left, price, 7 × Code found, CapWindowStarted row | 1280×900, 820×1100, 390×844, 320×700 | `screenshots/no-wallet-*.jpg`; `scrollWidth == innerWidth` at all four widths |
| Accessible names: every button/link named, every input labelled, one `main` | 1280 | report `a11y` |
| Keyboard walk: skip link first, then links, side radios, amount, slippage, contract links; `2px solid` accent outline at every stop (radio ring via `:has`) | 1280 | report `tabWalk` |
| Wallet on chain 1: connect → "Wrong network" notice, swap disabled with reason; click "Switch to Sepolia" → switch (4902) → `wallet_addEthereumChain` params deep-equal `network.json` `walletAddChain` → switch → notice gone, address chip | 1280 | `wallet-wrong-chain-1280.jpg`, report `walletLog` |
| Quote 0.01 ETH → 495,993.93 MAXT, minimum after 0.5%, rate; Buy enabled | 1280 | `wallet-quote-ok-1280.jpg` |
| 1 ETH → live quoter revert decoded: "would deliver 46,731,075 MAXT, above the 5,000,000 MAXT per-buy cap"; Buy disabled with reason; suggested ≈0.107 ETH | 1280 | `wallet-cap-warning-1280.jpg` |
| Empty amount → submit → inline error, focus on the field, `aria-invalid="true"` | 1280 | report |
| 0.01 ETH → Buy → router `execute` simulated against a funded account → wallet asked once (`to` = Universal Router, value 0.01 ETH, selector `0x3593564c`) → rejection shown | 1280 | `wallet-rejected-1280.jpg` |
| Sell side: steps list (Next/Pending), live quoter reports no ETH liquidity yet, submit label "Approve MAXT for Permit2", balance validation | 1280 | `wallet-sell-1280.jpg` |
| Connected at mobile width with cap warning, no overflow | 390×844 | `wallet-cap-warning-390.jpg` |

Console: no errors or warnings; no failed resource loads. (An earlier iteration produced 403s from
publicnode for an unbounded `eth_getLogs`; fixed, see F4.)

### Measured contrast (canvas-resolved sRGB of the rendered pair, final source)

| Pair | Ratio |
| --- | --- |
| lede / help / subtitle / balance aside (secondary text on white) | 8.45 |
| stat labels, units, eyebrow, table header, placeholder (muted on white) | 6.28 |
| muted text on quote panel | 5.69 |
| footer text on page background | 6.00 |
| accent link / Max button label on white | 8.35 |
| primary button label on accent fill | 6.18 |
| selected side control text on accent tint | 7.00 |
| active badge | 7.04 |
| danger notice text on its fill | 6.85 |
| stat values / address chip | 17.34 |

Not measured in the rendered state: the warning notice (`--warn-800` on `--warn-100`) and the "No
code" / muted badges; computed from the declared tokens they are above 4.5:1 but that is a token
computation, not a rendered measurement.

## 4. Better Interface review (six domains)

Coverage: all six domains reviewed against the final source and the rendered export above.

| Domain | Status | Notes |
| --- | --- | --- |
| Accessibility | Checked | native elements, labels, `aria-describedby`/`aria-invalid`, live regions (`role="status"` for quote and tx status, `role="alert"` for blocking notices), skip link, one `main`, `:focus-visible` ring verified at every tab stop, reduced-motion guard, 40–44px controls. Not performed: screen-reader session, browser-native 200% zoom, forced-colors mode, automated axe scan. |
| Layout | Checked | reflow at 320/390/820/1280 without horizontal scroll; logical properties; content-driven breakpoints (48rem, 60rem). Not performed: RTL mirror. |
| Writing | Checked | verb-first labels, sentence case, errors state the fix next to the field, one vocabulary (Buy/Sell/Approve), no blame or exclamation. |
| Typography | Checked | one family, six-step scale, descending heading sizes, tabular numbers on changing values, 16px inputs, `balance`/`pretty` wrapping, `overflow-wrap: anywhere` on hashes. Rendered wrapping inspected in screenshots at four widths. |
| Colors | Checked | oklch primitives → semantic tokens, one accent, status ramps only where rendered, contrast measured (table above). |
| UI | Checked | concentric radii (6/10/16), single card shadow, one filled action per card, 150ms color-only transitions, badges with text. Not performed: animation replay at 10% speed (no keyframe animations exist). |

### Findings and fixes

| # | Severity | Location | Finding | Fix | Recheck |
| --- | --- | --- | --- | --- | --- |
| F1 | HIGH | `web/src/components/WalletControls.tsx` | With no wallet installed the page still offered "Connect wallet" (wagmi lists its generic injected connector unconditionally); clicking would fail. | Probe each connector's provider; show "No browser wallet found…" when none exists. | No-wallet scenarios show the note. |
| F2 | HIGH | `web/src/App.tsx` | Default `loader` prop was a new function per render, so the manifest reloaded and the whole app remounted in a loop (buttons detached mid-click). | Module-level default loader. | Connect/switch flows stable. |
| F3 | HIGH | `WalletControls.tsx` | wagmi throws a synthetic `UserRejectedRequestError` (code 4001) when a wallet adds a chain without switching; it was read as a user rejection and the flow stopped on "Wrong network". | Treat only a provider-level 4001 (root cause) as a rejection; explicit add-then-switch fallback that re-reads `eth_chainId`. | Wrong-chain scenario passes; add params equal the handoff. |
| F4 | MEDIUM | `web/src/hooks/useLaunch.ts` | `eth_getLogs` from block 0 was refused (HTTP 403) by publicnode from the browser, producing console errors and RPC fallback churn. | Query `CapWindowStarted` at the single block `endBlock − WINDOW_BLOCKS`; bound swap logs to a 20,000-block lookback. | 0 failed requests. |
| F5 | HIGH | `web/src/components/SwapForm.tsx` | While the 12-second periodic re-quote was loading, submitting failed with "No fresh quote", so a swap could be refused spuriously. | A quote for the same amount/side stays usable during a refresh; the router call is always re-simulated before signing. | Confirmation tests pass; browser buy path reaches the wallet. |
| F6 | LOW | `SwapForm.tsx` | Status text lowercased the whole label ("buying maxt"). | "Buying MAXT: confirmed." phrasing. | Tests updated. |
| F7 | MEDIUM | `web/src/styles.css` `--neutral-500` | Muted text measured 4.28:1 on white, 3.88:1 on the quote panel and 4.09:1 in the footer at 13–14px, below AA 4.5:1. | Darkened the primitive to `oklch(49% 0.022 255)`. | 6.28 / 5.69 / 6.00. |
| F8 | LOW | `SwapForm.tsx` | While a cap warning showed, the quote panel rendered as an empty grey box. | Panel now says "No quote: the hook would revert this buy. Details below." | Cap-warning screenshot. |
| F9 | MEDIUM | `SwapForm.tsx` | On the live pool a sell cannot be quoted (the pool holds no ETH until the first buy) and the generic "try a smaller amount" advice was wrong. | Sell-specific message explaining that sells become possible once buys add ETH. | Sell scenario shows the message. |

Deliberate choices kept: the transaction control is natively `disabled` while chain, code
verification, pool state or the cap make a swap unsafe, with the reason written beside it (the guide's
"never disable submit" rule yields to contract safety); amount and slippage are validated on submit.

## 5. Limitations and untested live-chain behaviour

- No real transaction was broadcast. Buy execution was validated up to the wallet signature request
  against the live chain (simulation with a funded account) and end-to-end (sign → pending → confirmed)
  only against the fake RPC. Sell approvals and the sell swap were validated end-to-end only against the
  fake RPC; on the live pool a sell quote currently reverts with `NotEnoughLiquidity` because no buy has
  added ETH yet.
- `wallet_addEthereumChain` / `wallet_switchEthereumChain` were exercised with a mock provider, not
  with MetaMask or another real wallet.
- Cap expiry (`block.number >= endBlock`) was validated only with the fake RPC; on Sepolia the window
  was still open during validation.
- Chain reorganizations are not handled when listing events.
- Browser checks were scripted with playwright-core rather than the interactive MCP browser tool; a
  Playwright run is not a screen-reader session, a narrow viewport is not native zoom, and emulated
  mobile is not a physical device.
- No WalletConnect connector (no project id supplied); documented in `web/README.md`.

## 6. Completion

Complete for the stated scope. Source, lockfile, static export and manifest are committed together;
worker-side build, typecheck, tests and scripted browser checks passed on the final source. The
remaining limitations above are disclosed, not resolved.
