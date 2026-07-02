import { describe, it, expect } from 'vitest';
import {
  parseUnits,
  decodeFunctionData,
  type Address,
} from 'viem';
import {
  computeFeeSplit,
  validateFeeConfig,
  FeeConfigError,
  MAX_FEE_BASIS_POINTS,
  ERC20_ABI,
  type FeeSplitConfig,
  type TransactionIntent,
} from '../src/utils/feeSplitter.js';

const RECIPIENT = '0x1111111111111111111111111111111111111111' as Address;
const COLLECTOR = '0x2222222222222222222222222222222222222222' as Address;
const TOKEN = '0x3333333333333333333333333333333333333333' as Address;

const feeOn: FeeSplitConfig = {
  enabled: true,
  feeCollector: COLLECTOR,
  feeBasisPoints: 10, // 0.1%
};
const feeOff: FeeSplitConfig = {
  enabled: false,
  feeCollector: null,
  feeBasisPoints: 0,
};

function decodeTransfer(data: `0x${string}`): { to: Address; amount: bigint } {
  const { args } = decodeFunctionData({ abi: ERC20_ABI, data });
  return { to: args[0] as Address, amount: args[1] as bigint };
}

describe('computeFeeSplit — native token', () => {
  it('splits a native transfer accurately at 0.1%', () => {
    const intent: TransactionIntent = {
      tokenAddress: null,
      targetRecipient: RECIPIENT,
      totalAmountRaw: '1000',
      decimals: 18,
    };
    const total = parseUnits('1000', 18);
    const expectedFee = (total * 10n) / 10_000n;

    const res = computeFeeSplit(intent, feeOn);

    expect(res.feeApplied).toBe(true);
    expect(res.totalAmount).toBe(total);
    expect(res.feeAmount).toBe(expectedFee);
    expect(res.userAmount).toBe(total - expectedFee);
    expect(res.calls).toHaveLength(2);
    expect(res.calls[0]).toEqual({ to: RECIPIENT, value: total - expectedFee, data: '0x' });
    expect(res.calls[1]).toEqual({ to: COLLECTOR, value: expectedFee, data: '0x' });
  });

  it('sends the full amount in a single call when fees are disabled', () => {
    const intent: TransactionIntent = {
      tokenAddress: null,
      targetRecipient: RECIPIENT,
      totalAmountRaw: '5',
      decimals: 18,
    };
    const res = computeFeeSplit(intent, feeOff);
    expect(res.feeApplied).toBe(false);
    expect(res.feeAmount).toBe(0n);
    expect(res.calls).toHaveLength(1);
    expect(res.calls[0]).toEqual({ to: RECIPIENT, value: parseUnits('5', 18), data: '0x' });
  });
});

describe('computeFeeSplit — ERC20 routing', () => {
  it('produces two correctly-encoded transfer calls', () => {
    const intent: TransactionIntent = {
      tokenAddress: TOKEN,
      targetRecipient: RECIPIENT,
      totalAmountRaw: '1000',
      decimals: 6, // e.g. USDC
    };
    const total = parseUnits('1000', 6);
    const expectedFee = (total * 10n) / 10_000n;

    const res = computeFeeSplit(intent, feeOn);

    expect(res.calls).toHaveLength(2);
    for (const call of res.calls) {
      expect(call.to).toBe(TOKEN);
      expect(call.value).toBe(0n);
    }
    const userCall = decodeTransfer(res.calls[0]!.data);
    const feeCall = decodeTransfer(res.calls[1]!.data);
    expect(userCall).toEqual({ to: RECIPIENT, amount: total - expectedFee });
    expect(feeCall).toEqual({ to: COLLECTOR, amount: expectedFee });
  });

  it('routes the whole amount to the recipient when fees are off', () => {
    const intent: TransactionIntent = {
      tokenAddress: TOKEN,
      targetRecipient: RECIPIENT,
      totalAmountRaw: '42',
      decimals: 6,
    };
    const res = computeFeeSplit(intent, feeOff);
    expect(res.calls).toHaveLength(1);
    const call = decodeTransfer(res.calls[0]!.data);
    expect(call).toEqual({ to: RECIPIENT, amount: parseUnits('42', 6) });
  });
});

describe('computeFeeSplit — truncation & dust safety', () => {
  it('keeps sub-dust amounts whole (fee truncates to 0n)', () => {
    // 0.1% of 999 base units floors to 0 (999 * 10 / 10000 = 0).
    const intent: TransactionIntent = {
      tokenAddress: null,
      targetRecipient: RECIPIENT,
      totalAmountRaw: '999',
      decimals: 0,
    };
    const res = computeFeeSplit(intent, feeOn);
    expect(res.feeAmount).toBe(0n);
    expect(res.feeApplied).toBe(false);
    expect(res.userAmount).toBe(999n);
    expect(res.calls).toHaveLength(1);
    expect(res.calls[0]).toEqual({ to: RECIPIENT, value: 999n, data: '0x' });
  });

  it('applies exactly 1 unit of fee at the truncation boundary', () => {
    // 1000 * 10 / 10000 = 1.
    const intent: TransactionIntent = {
      tokenAddress: null,
      targetRecipient: RECIPIENT,
      totalAmountRaw: '1000',
      decimals: 0,
    };
    const res = computeFeeSplit(intent, feeOn);
    expect(res.feeAmount).toBe(1n);
    expect(res.userAmount).toBe(999n);
  });

  it('preserves the userAmount + feeAmount === totalAmount invariant across scales', () => {
    for (const raw of ['0', '1', '7', '123456789', '0.000001', '999999.999999']) {
      const intent: TransactionIntent = {
        tokenAddress: TOKEN,
        targetRecipient: RECIPIENT,
        totalAmountRaw: raw,
        decimals: 6,
      };
      const res = computeFeeSplit(intent, feeOn);
      expect(res.userAmount + res.feeAmount).toBe(res.totalAmount);
      expect(res.feeAmount >= 0n).toBe(true);
      expect(res.userAmount >= 0n).toBe(true);
    }
  });
});

describe('validateFeeConfig — anti-abuse guards', () => {
  it('passes for any disabled config', () => {
    expect(() => validateFeeConfig(feeOff)).not.toThrow();
    expect(() =>
      validateFeeConfig({ enabled: false, feeCollector: null, feeBasisPoints: 999999 }),
    ).not.toThrow();
  });

  it('rejects an enabled fee above the hard cap', () => {
    expect(() =>
      validateFeeConfig({
        enabled: true,
        feeCollector: COLLECTOR,
        feeBasisPoints: MAX_FEE_BASIS_POINTS + 1,
      }),
    ).toThrow(FeeConfigError);
  });

  it('rejects an enabled fee with no collector (no default recipient exists)', () => {
    expect(() =>
      validateFeeConfig({ enabled: true, feeCollector: null, feeBasisPoints: 10 }),
    ).toThrow(FeeConfigError);
  });

  it('rejects an enabled fee with a non-positive rate', () => {
    expect(() =>
      validateFeeConfig({ enabled: true, feeCollector: COLLECTOR, feeBasisPoints: 0 }),
    ).toThrow(FeeConfigError);
  });

  it('rejects a negative transfer amount', () => {
    const intent: TransactionIntent = {
      tokenAddress: null,
      targetRecipient: RECIPIENT,
      totalAmountRaw: '-100',
      decimals: 18,
    };
    expect(() => computeFeeSplit(intent, feeOff)).toThrow(FeeConfigError);
    expect(() => computeFeeSplit(intent, feeOn)).toThrow(FeeConfigError);
  });

  it('is enforced by computeFeeSplit as well', () => {
    const intent: TransactionIntent = {
      tokenAddress: null,
      targetRecipient: RECIPIENT,
      totalAmountRaw: '1',
      decimals: 18,
    };
    expect(() =>
      computeFeeSplit(intent, {
        enabled: true,
        feeCollector: COLLECTOR,
        feeBasisPoints: 500,
      }),
    ).toThrow(FeeConfigError);
  });
});
