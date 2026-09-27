/**
 * Interface fragments of the Uniswap v4 periphery the page talks to. These are protocol interfaces,
 * not deployed-contract configuration: every address is read at runtime from the deployment
 * manifest's `network.uniswapV4` block.
 */
import { parseAbi } from 'viem';

export const stateViewAbi = parseAbi([
  'function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)',
  'function getLiquidity(bytes32 poolId) view returns (uint128 liquidity)',
]);

export const quoterAbi = parseAbi([
  'struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }',
  'struct QuoteExactSingleParams { PoolKey poolKey; bool zeroForOne; uint128 exactAmount; bytes hookData; }',
  'function quoteExactInputSingle(QuoteExactSingleParams params) returns (uint256 amountOut, uint256 gasEstimate)',
  'error UnexpectedRevertBytes(bytes revertData)',
  'error NotEnoughLiquidity(bytes32 poolId)',
]);

export const universalRouterAbi = parseAbi([
  'function execute(bytes commands, bytes[] inputs, uint256 deadline) payable',
  'error V4TooLittleReceived(uint256 minAmountOutReceived, uint256 amountReceived)',
  'error TransactionDeadlinePassed()',
  'error ExecutionFailed(uint256 commandIndex, bytes message)',
  'error InsufficientETH()',
  'error InsufficientToken()',
]);

export const permit2Abi = parseAbi([
  'function approve(address token, address spender, uint160 amount, uint48 expiration)',
  'function allowance(address user, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)',
]);

export const erc20Abi = parseAbi([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
]);

/** PoolManager events and the error wrapper it uses around hook reverts. */
export const poolManagerAbi = parseAbi([
  'event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)',
  'event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)',
  'error WrappedError(address target, bytes4 selector, bytes reason, bytes details)',
  'error HookCallFailed()',
  'error CurrencyNotSettled()',
  'error PriceLimitAlreadyExceeded(uint160 sqrtPriceCurrentX96, uint160 sqrtPriceLimitX96)',
  'error PriceLimitOutOfBounds(uint160 sqrtPriceLimitX96)',
  'error SwapAmountCannotBeZero()',
]);

/** Universal Router command and v4 action bytes used by the swap encoder. */
export const UR_COMMAND_V4_SWAP = 0x10;
export const V4_ACTION_SWAP_EXACT_IN_SINGLE = 0x06;
export const V4_ACTION_SETTLE_ALL = 0x0c;
export const V4_ACTION_TAKE_ALL = 0x0f;
