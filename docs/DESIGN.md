# Design of the Maxtx (MAXT) launch page

This documents the design system actually implemented in `web/src/styles.css` and the components in
`web/src/components/`, so another page for this product can reuse the same tokens and patterns. It
was written from the final source after the browser review recorded in `docs/frontend-validation.md`.
(The assignment's write scope is `web/**`, `dist/**` and `docs/**`, so this file lives in `docs/`
rather than at the repository root.)

## Overview

Audience: people who hold Sepolia ETH and want to buy or sell MAXT while understanding the
MaxTxHook per-buy cap. The page is a single scrolling view of white cards on a cool off-white
background, with one blue accent used only for interactive things and one filled primary action per
card. Density is moderate: 16px body text, 20px card padding, stat values at 18px. There is no dark
theme, no illustration and no motion beyond a 150ms color transition on buttons.

System-wide rules: cards group content; space, not lines, separates groups; every changing number is
tabular; interactive elements always have a border or fill; status is never color alone (each badge
and notice carries text). The two-column arrangement of the first row (Buy cap + Pool beside Swap) is
this page's layout, not a rule for every page.

## Colors

All colors are `oklch()` custom properties on `:root` in `web/src/styles.css`. Primitives are named by
hue and step; components reference only the semantic tokens.

| Semantic token | Primitive | Value | Job |
| --- | --- | --- | --- |
| `--color-bg-page` | `--neutral-50` | `oklch(98.5% 0.004 255)` | page background |
| `--color-bg-surface` | white | `white` | cards, header, inputs, secondary buttons |
| `--color-bg-subtle` | `--neutral-100` | `oklch(96.5% 0.006 255)` | quote panel, table header, disabled input, neutral badge |
| `--color-bg-hover` | `--neutral-200` | `oklch(92% 0.009 255)` | reserved hover surface |
| `--color-border` | `--neutral-200` | `oklch(92% 0.009 255)` | table rules, header rule |
| `--color-border-strong` | `--neutral-300` | `oklch(86% 0.012 255)` | input, chip and secondary-button borders |
| `--color-text` | `--neutral-900` | `oklch(22% 0.03 255)` | body and values |
| `--color-text-secondary` | `--neutral-700` | `oklch(42% 0.025 255)` | ledes, help, fine print |
| `--color-text-muted` | `--neutral-500` | `oklch(49% 0.022 255)` | stat labels, units, placeholders, footer |
| `--color-accent-solid` / `-hover` / `-active` | `--accent-600/700/800` | `oklch(50% 0.17 262)` / `43%` / `36%` | filled primary button states |
| `--color-accent-text` | `--accent-700` | `oklch(43% 0.16 262)` | links, selected side control text |
| `--color-accent-bg` | `--accent-100` | `oklch(94% 0.03 262)` | selected side control, info notice, "Sell" badge |
| `--color-focus-ring` | `--accent-600` | `oklch(50% 0.17 262)` | `:focus-visible` outline |
| `--color-success-bg` / `--color-success-text` | `--success-100` / `--success-700` | `oklch(95% 0.05 150)` / `oklch(42% 0.12 150)` | "Active", "Code found", "Buy" badges; connected dot; confirmed status |
| `--color-warn-bg` / `--color-warn-text` | `--warn-100` / `--warn-800` | `oklch(96% 0.06 85)` / `oklch(40% 0.11 70)` | wrong-network and near-cap notices |
| `--color-danger-bg` / `--color-danger-text` | `--danger-100` / `--danger-700` | `oklch(95% 0.035 25)` / `oklch(45% 0.17 25)` | would-revert and failed notices, inline errors, "No code" badge |

Measured rendered contrast (Chromium, canvas-resolved sRGB, see `docs/validation/browser-report.json`)
is recorded in the validation document; every text pair used at 13–14px meets 4.5:1 after the
`--neutral-500` correction.

## Typography

- Family: system stack `--font-sans` (`ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto,
  'Helvetica Neue', Arial, sans-serif`). No web font files are shipped; the rendered face depends on
  the visitor's platform. Monospace `--font-mono` for addresses, hashes, RPC URLs and event names.
- Scale (rem): `--text-xs` 0.8125, `--text-sm` 0.875, `--text-base` 1, `--text-lg` 1.125,
  `--text-xl` 1.375, `--text-2xl` 1.875.
- Roles: `h1` 2xl/700 with `-0.01em` tracking; `h2` (card titles) xl/650; `h3` base/650; body base/400,
  line-height 1.5; headings 1.15. Ledes and help text use `--color-text-secondary`; stat labels are
  xs/600 uppercase with `0.02em` tracking in `--color-text-muted`; stat values lg/600.
- `text-wrap: balance` on headings, `pretty` on ledes and help; `overflow-wrap: anywhere` on
  headings, links and monospace values so hashes never overflow at 320px.
- `.num` applies `font-variant-numeric: tabular-nums` to every value that changes (block numbers,
  balances, quotes, table cells).
- Inputs are 16px (`--text-base`) so iOS does not zoom.
- Underlines use `from-font` position and thickness with `text-decoration-skip-ink: auto`.

## Layout

- Content width `--content-max: 72rem`, centered, `1rem` inline padding; the header is full-bleed white
  with a bottom hairline and the same inner width.
- Spacing scale `--space-1…10` on a 4px base. Cards use `--space-5` padding and `--space-4` internal
  gap; page sections are separated by `--space-6` (inter-group ≥ 2× intra-group).
- `.grid` is one column and becomes two equal columns at `min-width: 60rem`. `.stats` is
  `repeat(auto-fill, minmax(10rem, 1fr))`, so cards reflow from one to two stat columns on their own;
  `.stat-wide` spans the row. The contract list switches from stacked to a `10rem / 1fr / auto` row at
  `48rem`.
- The swaps table lives in `.table-wrap` with horizontal scrolling inside a bordered container; the rest
  of the page reflows to 320px with no horizontal scroll (checked at 320, 390, 820, 1280).
- Logical properties (`padding-inline`, `margin-block`, `inset-inline-start`, `text-align: start/end`)
  are used throughout; the skip link and `#main` scroll margin are in the base styles.

## Elevation & Depth

Flat with one card shadow. `.card` uses `--shadow-card` (two layered transparent black shadows) and no
border; structure inside a card comes from space. Borders are reserved for controls (inputs, secondary
buttons, chips, the segmented side control) and the table. Notices are tonal fills, not elevated.

## Shapes

`--radius-sm` 6px for inputs, buttons, chips and the side control; `--radius-md` 10px for notices,
quote panel and table wrapper; `--radius-lg` 16px for cards (inner 6px + 10px padding step keeps
nesting concentric); badges are pills (`999px`); the connection dot is a circle.

## Components

- **Card** (`.card`, `.card-head`, `.lede`, `.fine`) in every `components/*Card.tsx`: white surface,
  `<section aria-labelledby>` with an `h2`, optional badge in the head, lede paragraph, content, fine
  print. `aria-busy` while its reads load.
- **Stat grid** (`.stats`, `.stat`, `.stat-wide`, `dt`/`dd.num`, `.unit`): label-over-value pairs;
  used by `CapCard.tsx` and `PoolCard.tsx`.
- **Badge** (`.badge`, `-active`, `-muted`, `-danger`, `-buy`, `-sell`): pill with text and, for status,
  a `.dot`. Always carries a word; never color alone.
- **Notice** (`.notice`, `-info`, `-warn`, `-danger`): tonal panel with `role="alert"` for blocking
  problems (wrong network, would revert, failed) and `role="status"` for informational ones.
- **Buttons** (`.button`, `-primary`, `-secondary`, `-large`, `.link-button`): 40px minimum height
  (44px for `-large`), one filled primary per card, `:disabled` at 55% opacity with the reason written
  beside it. `.link-button` is the small bordered "Max" control.
- **Address chip** (`.address-chip`, `WalletControls.tsx`): bordered monospace link to the explorer
  with a green connected dot; sits beside "Disconnect".
- **Segmented side control** (`.segmented`, `.seg`, `.seg-on`, `SwapForm.tsx`): a `fieldset` of two
  native radios styled as bordered chips; the selected one gets the accent tint; focus ring on the
  label via `:has(input:focus-visible)`.
- **Field** (`.field`, `.field-row`, `.field-aside`, `.input`, `.help`, `.inline-error`): label above a
  full-width input, help text under it, error text with a ⚠ prefix bound through `aria-describedby`
  and `aria-invalid`.
- **Quote panel** (`.quote`, `.quote-grid`): subtle-filled `role="status"` block listing estimated
  output, minimum after slippage and rate.
- **Steps** (`.steps`): ordered list of the sell approvals with a Next / Pending / In progress / Done
  state word per row.
- **Event list and swaps table** (`.event-list`, `.swaps`, `.table-wrap`) in `ActivityCard.tsx`.
- **Contract list and meta** (`.contract-list`, `.meta`, `.plain-list`) in `ContractsCard.tsx`.

Focus: every interactive element uses the browser-independent `:focus-visible` rule
`outline: 2px solid var(--color-focus-ring); outline-offset: 2px`. Motion: only `.button` transitions
`background-color, color, border-color` for 150ms; `prefers-reduced-motion: reduce` shortens it to
0.01ms.

## Do's and Don'ts

- Start a new page from `.page` + `.card`; put one `h1` in a `.page-header` and one `<main id="main">`.
- Use the filled `.button-primary` for exactly one action per card; peers are `.button-secondary`.
- Put status in a `.badge` or `.notice` with words; pick the ramp by meaning (success / warn / danger),
  never by how it looks.
- Reference semantic tokens only; add a token if a role is missing instead of borrowing a border color
  for text.
- Apply `.num` to anything that updates; keep values in `dd` elements inside `.stats`.
- Keep addresses and hashes in `.mono` with `translate="no"` and a full value in `title` when truncated.
- Do not add a dark theme, web fonts, animations or a second accent hue; they are not part of this
  system.

Recipe for another page: copy `index.html`, mount a component that renders `.page-header` +
`.page` with `.card` sections, reuse `WalletControls` for connection and chain switching, and read
chain data through `useLaunch` or a sibling hook that takes the runtime `Deployment`.
