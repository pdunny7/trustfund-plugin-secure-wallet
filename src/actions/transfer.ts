import { parseUnits, isAddress, formatUnits, type Address, type Hex } from 'viem';
import {
  computeFeeSplit,
  type FeeSplitConfig,
  type FeeSplitResult,
  type TransactionIntent,
} from '../utils/feeSplitter.js';

export class GuardrailError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'GuardrailError';
    this.code = code;
  }
}

/**
 * A validated multi-sig approval that authorizes a transfer to bypass a
 * guardrail (exceeding the per-transaction limit, or sending to a
 * non-allowlisted recipient). The integrator is responsible for verifying the
 * signatures on-chain / against the account's owner set before constructing
 * this object; here we enforce that a threshold number is present and the
 * approval is explicit.
 */
export interface OverrideApproval {
  approved: boolean;
  signatures: Hex[];
  threshold: number;
}

export interface GuardrailConfig {
  /** Max value per transaction, as a human-readable amount. null = no cap. */
  maxTransactionRaw: string | null;
  /** If set and non-empty, only these recipients are permitted. null = any. */
  recipientAllowlist: Address[] | null;
  /**
   * When true, exceeding maxTransactionRaw is permitted ONLY with a valid
   * override. When false, exceeding the limit is always rejected.
   */
  requireOverrideAboveLimit: boolean;
}

function isValidOverride(override: OverrideApproval | undefined): boolean {
  return (
    override !== undefined &&
    override.approved &&
    override.threshold > 0 &&
    override.signatures.length >= override.threshold
  );
}

/**
 * The guardrail engine. Parses the numeric magnitude of the intent, compares it
 * against configured thresholds and the recipient allowlist, and throws an
 * explicit GuardrailError when a boundary is breached without a validated
 * override. Returns normally when the transfer is permitted.
 */
export function assertWithinGuardrails(
  intent: TransactionIntent,
  guardrails: GuardrailConfig,
  override?: OverrideApproval,
): void {
  if (!isAddress(intent.targetRecipient)) {
    throw new GuardrailError('INVALID_RECIPIENT', `Invalid recipient address: ${intent.targetRecipient}`);
  }

  if (guardrails.recipientAllowlist && guardrails.recipientAllowlist.length > 0) {
    const target = intent.targetRecipient.toLowerCase();
    const allowed = guardrails.recipientAllowlist.some((a) => a.toLowerCase() === target);
    if (!allowed && !isValidOverride(override)) {
      throw new GuardrailError(
        'RECIPIENT_NOT_ALLOWED',
        `Recipient ${intent.targetRecipient} is not on the allowlist and no valid multi-sig override was provided.`,
      );
    }
  }

  if (guardrails.maxTransactionRaw !== null) {
    const amount = parseUnits(intent.totalAmountRaw, intent.decimals);
    const max = parseUnits(guardrails.maxTransactionRaw, intent.decimals);
    if (amount > max) {
      if (!guardrails.requireOverrideAboveLimit) {
        throw new GuardrailError(
          'LIMIT_EXCEEDED',
          `Amount ${intent.totalAmountRaw} exceeds the configured maximum ${guardrails.maxTransactionRaw}.`,
        );
      }
      if (!isValidOverride(override)) {
        throw new GuardrailError(
          'OVERRIDE_REQUIRED',
          `Amount ${intent.totalAmountRaw} exceeds the maximum ${guardrails.maxTransactionRaw} and requires a validated multi-sig override.`,
        );
      }
    }
  }
}

export interface PreparedTransfer {
  split: FeeSplitResult;
  /** Human-readable fee disclosure, or null when no fee was applied. */
  disclosure: string | null;
}

/**
 * Human-readable per-transaction disclosure of the fee that was applied. This
 * is surfaced to the runtime/user so the fee is never silent.
 */
function buildDisclosure(
  intent: TransactionIntent,
  split: FeeSplitResult,
  feeCollector: Address,
): string {
  const unit = intent.tokenAddress === null ? 'native token' : `token ${intent.tokenAddress}`;
  return (
    `Convenience fee applied: ${formatUnits(split.feeAmount, intent.decimals)} ${unit} ` +
    `(recipient receives ${formatUnits(split.userAmount, intent.decimals)} of ` +
    `${formatUnits(split.totalAmount, intent.decimals)}). Fee routed to ${feeCollector}.`
  );
}

/**
 * End-to-end preparation: enforces guardrails, then computes the (optional) fee
 * split, returning the atomic batch plus a disclosure string. Does not touch
 * the network — hand `result.split.calls` to executeAtomicBatch.
 */
export function prepareSecureTransfer(
  intent: TransactionIntent,
  feeConfig: FeeSplitConfig,
  guardrails: GuardrailConfig,
  override?: OverrideApproval,
): PreparedTransfer {
  assertWithinGuardrails(intent, guardrails, override);
  const split = computeFeeSplit(intent, feeConfig);
  const disclosure =
    split.feeApplied && feeConfig.feeCollector !== null
      ? buildDisclosure(intent, split, feeConfig.feeCollector)
      : null;
  return { split, disclosure };
}
