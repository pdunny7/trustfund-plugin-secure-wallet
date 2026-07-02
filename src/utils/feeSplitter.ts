import {
  parseUnits,
  isAddress,
  encodeFunctionData,
  type Address,
  type Hex,
} from 'viem';

/**
 * Minimal ERC20 `transfer` ABI. Exported so the action layer and tests can
 * decode the calls this module produces without redefining the shape.
 */
export const ERC20_ABI = [
  {
    name: 'transfer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'recipient', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

/**
 * Hard ceiling on the convenience fee. A deployer may configure anything from 0
 * up to this value, but never beyond it. 100 bps = 1%.
 *
 * This is a deliberate anti-abuse guard: even a misconfigured or malicious
 * deployment cannot use this library to skim more than 1% of a transfer.
 */
export const MAX_FEE_BASIS_POINTS = 100;

/** Basis-point denominator. 10 bps / 10_000 = 0.1%. */
const BPS_DENOMINATOR = 10_000n;

export class FeeConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FeeConfigError';
  }
}

export interface FeeSplitConfig {
  /**
   * Fees are OFF unless a deployer explicitly turns them on. This library never
   * charges a fee by default.
   */
  enabled: boolean;
  /**
   * Where the fee goes. There is deliberately NO default value.
   *
   * If fees are enabled the deployer must supply their OWN address here. The
   * library ships no hardcoded recipient, so it is structurally incapable of
   * silently routing funds to the plugin author or any third party.
   */
  feeCollector: Address | null;
  /** 10 = 0.1%. Must be > 0 when enabled, and is capped at MAX_FEE_BASIS_POINTS. */
  feeBasisPoints: number;
}

export interface TransactionIntent {
  /** null = native gas token (ETH etc.); otherwise the ERC20 contract address. */
  tokenAddress: Address | null;
  targetRecipient: Address;
  /** Human-readable amount (e.g. "1.5"), converted with `decimals` via parseUnits. */
  totalAmountRaw: string;
  decimals: number;
}

export interface OnChainCall {
  to: Address;
  value: bigint;
  data: Hex;
}

export interface FeeSplitResult {
  /** The atomic batch to hand to the smart-account client, in order. */
  calls: OnChainCall[];
  totalAmount: bigint;
  userAmount: bigint;
  feeAmount: bigint;
  /**
   * True only when a non-zero fee was actually deducted. Note this is false
   * even when fees are enabled if the amount is small enough that the fee
   * truncates to 0 (sub-dust); in that case the user keeps the full amount.
   */
  feeApplied: boolean;
}

/**
 * Validates a fee configuration. A disabled config always passes. An enabled
 * config must name a valid collector and a positive, capped basis-point rate.
 * Call this at startup to fail fast on misconfiguration.
 */
export function validateFeeConfig(config: FeeSplitConfig): void {
  if (!config.enabled) return;

  if (!Number.isInteger(config.feeBasisPoints) || config.feeBasisPoints <= 0) {
    throw new FeeConfigError(
      `Fees are enabled but feeBasisPoints (${config.feeBasisPoints}) is not a positive integer. ` +
        'Disable fees instead of configuring a zero/negative rate.',
    );
  }
  if (config.feeBasisPoints > MAX_FEE_BASIS_POINTS) {
    throw new FeeConfigError(
      `feeBasisPoints (${config.feeBasisPoints}) exceeds the hard cap of ${MAX_FEE_BASIS_POINTS} (1%).`,
    );
  }
  if (config.feeCollector === null || !isAddress(config.feeCollector)) {
    throw new FeeConfigError(
      'Fees are enabled but no valid feeCollector is set. Configure it to YOUR own address — ' +
        'this library intentionally has no default recipient.',
    );
  }
}

function buildTransferCall(
  tokenAddress: Address | null,
  to: Address,
  amount: bigint,
): OnChainCall {
  if (tokenAddress === null) {
    return { to, value: amount, data: '0x' };
  }
  return {
    to: tokenAddress,
    value: 0n,
    data: encodeFunctionData({
      abi: ERC20_ABI,
      functionName: 'transfer',
      args: [to, amount],
    }),
  };
}

/**
 * Decomposes a transfer intent into an atomic on-chain batch, optionally
 * deducting a bounded, opt-in convenience fee.
 *
 * All arithmetic is pure BigInt. The fee is floor-divided, so any fractional
 * dust remains in the user's payload rather than being lost or under-flowing:
 *
 *   feeAmount  = floor(totalAmount * feeBasisPoints / 10_000)
 *   userAmount = totalAmount - feeAmount
 *
 * The returned `userAmount + feeAmount === totalAmount` invariant always holds.
 */
export function computeFeeSplit(
  intent: TransactionIntent,
  config: FeeSplitConfig,
): FeeSplitResult {
  validateFeeConfig(config);

  if (!isAddress(intent.targetRecipient)) {
    throw new FeeConfigError(`Invalid recipient address: ${intent.targetRecipient}`);
  }
  if (intent.tokenAddress !== null && !isAddress(intent.tokenAddress)) {
    throw new FeeConfigError(`Invalid token address: ${intent.tokenAddress}`);
  }
  if (!Number.isInteger(intent.decimals) || intent.decimals < 0) {
    throw new FeeConfigError(`Invalid decimals: ${intent.decimals}`);
  }

  const totalAmount = parseUnits(intent.totalAmountRaw, intent.decimals);

  const feeActive =
    config.enabled && config.feeBasisPoints > 0 && config.feeCollector !== null;

  const feeAmount = feeActive
    ? (totalAmount * BigInt(config.feeBasisPoints)) / BPS_DENOMINATOR
    : 0n;
  const userAmount = totalAmount - feeAmount;
  const feeApplied = feeAmount > 0n;

  const calls: OnChainCall[] = [];
  if (!feeApplied) {
    // No fee (disabled, zero-rate, or sub-dust truncation): user keeps everything.
    calls.push(buildTransferCall(intent.tokenAddress, intent.targetRecipient, totalAmount));
  } else {
    // config.feeCollector is non-null here (feeActive implies it).
    const collector = config.feeCollector as Address;
    calls.push(buildTransferCall(intent.tokenAddress, intent.targetRecipient, userAmount));
    calls.push(buildTransferCall(intent.tokenAddress, collector, feeAmount));
  }

  return { calls, totalAmount, userAmount, feeAmount, feeApplied };
}
