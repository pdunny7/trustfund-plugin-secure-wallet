import { describe, it, expect } from 'vitest';
import type { Address } from 'viem';
import {
  assertWithinGuardrails,
  prepareSecureTransfer,
  GuardrailError,
  type GuardrailConfig,
  type OverrideApproval,
} from '../src/actions/transfer.js';
import type { FeeSplitConfig, TransactionIntent } from '../src/utils/feeSplitter.js';

const RECIPIENT = '0x1111111111111111111111111111111111111111' as Address;
const OTHER = '0x4444444444444444444444444444444444444444' as Address;
const COLLECTOR = '0x2222222222222222222222222222222222222222' as Address;

const baseIntent: TransactionIntent = {
  tokenAddress: null,
  targetRecipient: RECIPIENT,
  totalAmountRaw: '100',
  decimals: 18,
};

const validOverride: OverrideApproval = {
  approved: true,
  signatures: ['0xabc', '0xdef'],
  threshold: 2,
};

const feeOff: FeeSplitConfig = { enabled: false, feeCollector: null, feeBasisPoints: 0 };

describe('assertWithinGuardrails — limits', () => {
  const guardrails: GuardrailConfig = {
    maxTransactionRaw: '50',
    recipientAllowlist: null,
    requireOverrideAboveLimit: true,
  };

  it('allows a transfer within the limit', () => {
    expect(() =>
      assertWithinGuardrails({ ...baseIntent, totalAmountRaw: '10' }, guardrails),
    ).not.toThrow();
  });

  it('rejects a transfer over the limit without an override', () => {
    expect(() => assertWithinGuardrails(baseIntent, guardrails)).toThrow(GuardrailError);
    try {
      assertWithinGuardrails(baseIntent, guardrails);
    } catch (e) {
      expect((e as GuardrailError).code).toBe('OVERRIDE_REQUIRED');
    }
  });

  it('allows a transfer over the limit with a valid override', () => {
    expect(() => assertWithinGuardrails(baseIntent, guardrails, validOverride)).not.toThrow();
  });

  it('rejects an override that does not meet its threshold', () => {
    const weak: OverrideApproval = { approved: true, signatures: ['0xabc'], threshold: 2 };
    expect(() => assertWithinGuardrails(baseIntent, guardrails, weak)).toThrow(GuardrailError);
  });

  it('rejects an unapproved override', () => {
    const unapproved: OverrideApproval = { ...validOverride, approved: false };
    expect(() => assertWithinGuardrails(baseIntent, guardrails, unapproved)).toThrow(GuardrailError);
  });

  it('hard-rejects over-limit transfers when override is not permitted', () => {
    const noOverride: GuardrailConfig = { ...guardrails, requireOverrideAboveLimit: false };
    try {
      assertWithinGuardrails(baseIntent, noOverride, validOverride);
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as GuardrailError).code).toBe('LIMIT_EXCEEDED');
    }
  });
});

describe('assertWithinGuardrails — allowlist', () => {
  const guardrails: GuardrailConfig = {
    maxTransactionRaw: null,
    recipientAllowlist: [RECIPIENT],
    requireOverrideAboveLimit: true,
  };

  it('allows an allowlisted recipient', () => {
    expect(() => assertWithinGuardrails(baseIntent, guardrails)).not.toThrow();
  });

  it('rejects a non-allowlisted recipient without override', () => {
    const intent = { ...baseIntent, targetRecipient: OTHER };
    try {
      assertWithinGuardrails(intent, guardrails);
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as GuardrailError).code).toBe('RECIPIENT_NOT_ALLOWED');
    }
  });

  it('allows a non-allowlisted recipient with a valid override', () => {
    const intent = { ...baseIntent, targetRecipient: OTHER };
    expect(() => assertWithinGuardrails(intent, guardrails, validOverride)).not.toThrow();
  });
});

describe('prepareSecureTransfer — integration', () => {
  it('enforces guardrails before computing the split', () => {
    const guardrails: GuardrailConfig = {
      maxTransactionRaw: '50',
      recipientAllowlist: null,
      requireOverrideAboveLimit: false,
    };
    expect(() => prepareSecureTransfer(baseIntent, feeOff, guardrails)).toThrow(GuardrailError);
  });

  it('returns a null disclosure when no fee applies', () => {
    const guardrails: GuardrailConfig = {
      maxTransactionRaw: null,
      recipientAllowlist: null,
      requireOverrideAboveLimit: false,
    };
    const res = prepareSecureTransfer(baseIntent, feeOff, guardrails);
    expect(res.disclosure).toBeNull();
    expect(res.split.calls).toHaveLength(1);
  });

  it('returns a disclosure string when a fee applies', () => {
    const guardrails: GuardrailConfig = {
      maxTransactionRaw: null,
      recipientAllowlist: null,
      requireOverrideAboveLimit: false,
    };
    const feeOn: FeeSplitConfig = { enabled: true, feeCollector: COLLECTOR, feeBasisPoints: 10 };
    const res = prepareSecureTransfer(baseIntent, feeOn, guardrails);
    expect(res.disclosure).toContain('Convenience fee applied');
    expect(res.disclosure).toContain(COLLECTOR);
    expect(res.split.calls).toHaveLength(2);
  });
});
