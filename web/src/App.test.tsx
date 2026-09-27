/**
 * Interaction tests for the primary controls against a fake JSON-RPC backend and a mock EIP-1193
 * wallet. No real network, funds or broadcasts are involved.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { decodeFunctionData, parseEther } from 'viem';
import { App } from './App';
import { erc20Abi, universalRouterAbi } from './abi/uniswap';
import { buildDeployment, defaultState, fakeRpc, mockWallet, networkHandoff, RICH, TX_HASH, type FakeChainState } from './test/fixtures';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

function mount(options: { chainId?: `0x${string}`; state?: FakeChainState; rejectSend?: boolean } = {}) {
  const deployment = buildDeployment();
  const state = options.state ?? defaultState();
  const rpc = fakeRpc(deployment, state);
  const wallet = mockWallet({ account: RICH, chainId: options.chainId ?? '0xaa36a7', rpc: rpc.request, state, rejectSend: options.rejectSend });
  const loader = () => Promise.resolve(deployment);
  const configOptions = { provider: wallet.provider, transport: rpc.transport };
  render(<App loader={loader} configOptions={configOptions} />);
  return { deployment, state, wallet, rpc };
}

async function connect() {
  const button = await screen.findByRole('button', { name: /Connect wallet/ }, { timeout: 10_000 });
  await userEvent.click(button);
  await screen.findByRole('link', { name: /0x232e…1b0a/i }, { timeout: 10_000 });
}

describe('reads without a wallet connection', () => {
  it('shows the cap, its status, blocks left, the price and verified contract code', async () => {
    mount();
    const cap = await screen.findByRole('region', { name: 'Buy cap' }, { timeout: 10_000 });
    await within(cap).findByText('Active', {}, { timeout: 10_000 });
    expect(within(cap).getByText('5,000,000')).toBeInTheDocument();
    await waitFor(() => expect(within(cap).getByText('6,976')).toBeInTheDocument(), { timeout: 10_000 });
    expect(within(cap).getByText('11,798,676')).toBeInTheDocument();
    const pool = screen.getByRole('region', { name: 'Pool' });
    await within(pool).findByText('100,000,000', {}, { timeout: 10_000 });
    const contracts = screen.getByRole('region', { name: 'Contracts' });
    await waitFor(() => expect(within(contracts).getAllByText('Code found')).toHaveLength(7), { timeout: 10_000 });
    expect(within(contracts).getByText(networkHandoff.network.uniswapV4.universalRouter)).toBeInTheDocument();
    const activity = screen.getByRole('region', { name: 'Activity' });
    await within(activity).findByText('CapWindowStarted', {}, { timeout: 10_000 });
    await within(activity).findByText('Buy', {}, { timeout: 10_000 });
    expect(screen.getByRole('button', { name: /Buy MAXT/ })).toBeDisabled();
    expect(screen.getByText('Connect a wallet to swap.')).toBeInTheDocument();
  });
});

describe('wallet connection and chain switching', () => {
  it('offers wallet_addEthereumChain with the handoff parameters when the wallet does not know the chain', async () => {
    const { wallet } = mount({ chainId: '0x1' });
    await connect();
    await screen.findByText('Wrong network.', {}, { timeout: 10_000 });
    expect(screen.getByRole('button', { name: /Buy MAXT/ })).toBeDisabled();
    expect(screen.getByText('Switch the wallet to Sepolia to swap.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Switch to Sepolia' }));
    await waitFor(() => expect(screen.queryByText('Wrong network.')).not.toBeInTheDocument(), { timeout: 10_000 });
    const methods = wallet.log.map((l) => l.method).filter((m) => m.startsWith('wallet_'));
    const addIndex = methods.indexOf('wallet_addEthereumChain');
    expect(addIndex).toBeGreaterThan(0);
    expect(methods[addIndex - 1]).toBe('wallet_switchEthereumChain');
    expect(methods.slice(addIndex + 1)).toContain('wallet_switchEthereumChain');
    const add = wallet.log.find((l) => l.method === 'wallet_addEthereumChain')!;
    expect(JSON.parse(JSON.stringify((add.params as unknown[])[0]))).toEqual(networkHandoff.walletAddChain);
    expect(wallet.currentChainId()).toBe('0xaa36a7');
  });

  it('disconnects and returns to the connect state', async () => {
    mount();
    await connect();
    await userEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    await screen.findByRole('button', { name: /Connect wallet/ });
  });
});

describe('buying', () => {
  it('quotes the output, simulates, signs through the wallet and reports confirmation', async () => {
    const { state } = mount();
    await connect();
    await screen.findByText(/Balance 10 ETH/, {}, { timeout: 10_000 });
    await userEvent.type(screen.getByLabelText(/You pay/), '0.01');
    await screen.findByText('You receive (estimated)', {}, { timeout: 10_000 });
    const quote = within(document.querySelector('.quote') as HTMLElement);
    expect(quote.getByText(/^490,000/)).toBeInTheDocument(); // 0.01 ETH × 49,000,000 rate
    expect(quote.getByText(/^487,550/)).toBeInTheDocument(); // 0.5% slippage
    const buy = screen.getByRole('button', { name: /Buy MAXT/ });
    await waitFor(() => expect(buy).toBeEnabled(), { timeout: 10_000 });
    await userEvent.click(buy);
    await screen.findByText(/Buying MAXT: confirmed\./, {}, { timeout: 15_000 });
    expect(state.sentTransactions).toHaveLength(1);
    const tx = state.sentTransactions[0]!;
    expect(tx.to.toLowerCase()).toBe(networkHandoff.network.uniswapV4.universalRouter);
    expect(tx.value).toBe(parseEther('0.01'));
    const decoded = decodeFunctionData({ abi: universalRouterAbi, data: tx.data });
    expect(decoded.functionName).toBe('execute');
    expect(decoded.args[0]).toBe('0x10');
    expect(screen.getByRole('link', { name: /View transaction/ })).toHaveAttribute('href', `${networkHandoff.network.explorer}/tx/${TX_HASH}`);
  });

  it('warns and disables the buy when the hook would revert with CapExceeded', async () => {
    mount();
    await connect();
    await screen.findByText(/Balance 10 ETH/, {}, { timeout: 10_000 });
    await userEvent.type(screen.getByLabelText(/You pay/), '1');
    await screen.findByText('This buy would revert.', {}, { timeout: 10_000 });
    expect(screen.getByText(/would deliver 49,000,000 MAXT, above the 5,000,000 MAXT per-buy cap/)).toBeInTheDocument();
    expect(screen.getByText(/Roughly 0.10204 ETH or less/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Buy MAXT/ })).toBeDisabled();
    expect(screen.getByText('This buy is above the cap and would revert. Reduce the amount.')).toBeInTheDocument();
  });

  it('does not warn about the cap once the window has expired', async () => {
    const state = defaultState();
    state.blockNumber = state.endBlock + 5n;
    mount({ state });
    const cap = await screen.findByRole('region', { name: 'Buy cap' }, { timeout: 10_000 });
    await within(cap).findByText('Expired', {}, { timeout: 10_000 });
    await connect();
    await screen.findByText(/Balance 10 ETH/, {}, { timeout: 10_000 });
    await userEvent.type(screen.getByLabelText(/You pay/), '1');
    await screen.findByText('You receive (estimated)', {}, { timeout: 10_000 });
    expect(screen.queryByText('This buy would revert.')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: /Buy MAXT/ })).toBeEnabled(), { timeout: 10_000 });
  });

  it('validates on submit, focuses the amount field, and reports a wallet rejection', async () => {
    const state = defaultState();
    state.ethBalance = parseEther('0.05');
    mount({ state, rejectSend: true });
    await connect();
    await screen.findByText(/Balance 0.05 ETH/, {}, { timeout: 10_000 });
    const buy = screen.getByRole('button', { name: /Buy MAXT/ });
    await waitFor(() => expect(buy).toBeEnabled(), { timeout: 10_000 });
    await userEvent.click(buy);
    const amount = screen.getByLabelText(/You pay/);
    expect(amount).toHaveFocus();
    expect(amount).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText(/Enter how much ETH to spend/)).toBeInTheDocument();

    await userEvent.type(amount, '0.09');
    await screen.findByText('You receive (estimated)', {}, { timeout: 10_000 });
    await waitFor(() => expect(buy).toBeEnabled(), { timeout: 10_000 });
    await userEvent.click(buy);
    expect(screen.getByText(/Enter at most 0.05 ETH, your current balance/)).toBeInTheDocument();

    await userEvent.clear(amount);
    await userEvent.type(amount, '0.01');
    await waitFor(() => expect(within(document.querySelector('.quote') as HTMLElement).getByText(/^490,000/)).toBeInTheDocument(), { timeout: 10_000 });
    await userEvent.click(buy);
    await waitFor(() => expect(document.body.textContent).toMatch(/failed\./), { timeout: 10_000 });
    expect(document.querySelector('.notice-danger')?.textContent).toContain('Request rejected in the wallet. Nothing was sent.');
  });
});

describe('selling', () => {
  it('walks the approval steps: token → Permit2, Permit2 → router, then the swap', async () => {
    const state = defaultState();
    state.tokenBalance = 1_000_000n * 10n ** 18n;
    const { deployment } = mount({ state });
    await connect();
    await userEvent.click(screen.getByLabelText(/Sell MAXT/));
    await screen.findByText(/Balance 1,000,000 MAXT/, {}, { timeout: 10_000 });
    const steps = screen.getByRole('list', { name: 'Steps to sell' });
    expect(within(steps).getAllByText('Next')).toHaveLength(1);
    await userEvent.type(screen.getByLabelText(/You sell/), '1000');
    await screen.findByText('You receive (estimated)', {}, { timeout: 10_000 });

    // Step 1: ERC-20 approve(permit2, amount)
    const submit = screen.getByRole('button', { name: /Approve MAXT for Permit2/ });
    await waitFor(() => expect(submit).toBeEnabled(), { timeout: 10_000 });
    await userEvent.click(submit);
    await screen.findByText(/Approving the token for Permit2: confirmed\./, {}, { timeout: 15_000 });
    const approve = state.sentTransactions[0]!;
    expect(approve.to.toLowerCase()).toBe(deployment.token.address);
    const decodedApprove = decodeFunctionData({ abi: erc20Abi, data: approve.data });
    expect(decodedApprove.functionName).toBe('approve');
    expect(String(decodedApprove.args?.[0]).toLowerCase()).toBe(networkHandoff.network.uniswapV4.permit2);
    expect(decodedApprove.args[1]).toBe(1000n * 10n ** 18n);

    // The chain now reports the allowance; step 2 becomes the next action.
    state.permit2Allowance = 1000n * 10n ** 18n;
    const permitButton = await screen.findByRole('button', { name: /Approve the router/ }, { timeout: 15_000 });
    await userEvent.click(permitButton);
    await screen.findByText(/Approving the Universal Router in Permit2: confirmed\./, {}, { timeout: 15_000 });
    expect(state.sentTransactions[1]!.to.toLowerCase()).toBe(networkHandoff.network.uniswapV4.permit2);

    state.routerAllowance = { amount: 1000n * 10n ** 18n, expiration: Math.floor(Date.now() / 1000) + 3600 };
    const sell = await screen.findByRole('button', { name: /^Sell MAXT$/ }, { timeout: 15_000 });
    await waitFor(() => expect(sell).toBeEnabled(), { timeout: 10_000 });
    await userEvent.click(sell);
    await screen.findByText(/Selling MAXT: confirmed\./, {}, { timeout: 15_000 });
    const swap = state.sentTransactions[2]!;
    expect(swap.to.toLowerCase()).toBe(networkHandoff.network.uniswapV4.universalRouter);
    expect(swap.value).toBe(0n);
  }, 60_000);
});
