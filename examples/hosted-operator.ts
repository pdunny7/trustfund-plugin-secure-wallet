/**
 * Minimal operator-side wiring for the TrustFund hosted service (open-core
 * model, see SERVICE.md).
 *
 * This is the shape a hosted operator uses: each paying customer has agreed to
 * your Terms of Service (which disclose the fee), and their agent runs with the
 * fee enabled and routed to YOUR operator collector address. Customers who
 * self-host the free package instead simply leave fees disabled and pay nothing.
 *
 * Run: this file is illustrative; swap in a real SmartAccountClient (Biconomy,
 * ZeroDev, permissionless.js, ...) to execute against a chain.
 */
import type { Address } from 'viem';
import {
  createSecureWalletPlugin,
  type SmartAccountClient,
} from '../src/index.js';

/** Your operator collector — the single address all serviced fees flow to. */
const OPERATOR_FEE_COLLECTOR = '0xYourOperatorCollectorAddress000000000000' as Address;

/** Per-customer record from your control plane (accounts + signed ToS). */
interface HostedCustomer {
  id: string;
  /** Must be true before enabling fees — proves the fee was disclosed & accepted. */
  acceptedFeeTerms: boolean;
  smartAccountClient: SmartAccountClient;
  chainId: number;
  /** Per-customer policy the operator manages from the dashboard. */
  maxTransactionRaw: string | null;
  recipientAllowlist: Address[] | null;
}

/**
 * Builds the plugin for one hosted customer. Fees are only turned on once the
 * customer has accepted the fee terms; otherwise they run fee-free.
 */
export function buildPluginForCustomer(customer: HostedCustomer) {
  if (!customer.acceptedFeeTerms) {
    // No accepted ToS => no fee. Never charge a customer who didn't agree.
    return createSecureWalletPlugin({
      wallet: { client: customer.smartAccountClient, chainId: customer.chainId },
      guardrails: {
        maxTransactionRaw: customer.maxTransactionRaw,
        recipientAllowlist: customer.recipientAllowlist,
        requireOverrideAboveLimit: true,
      },
      fee: { enabled: false, feeCollector: null, feeBasisPoints: 0 },
      logger: (m) => console.info(`[customer:${customer.id}] ${m}`),
    });
  }

  return createSecureWalletPlugin({
    wallet: { client: customer.smartAccountClient, chainId: customer.chainId },
    guardrails: {
      maxTransactionRaw: customer.maxTransactionRaw,
      recipientAllowlist: customer.recipientAllowlist,
      requireOverrideAboveLimit: true,
    },
    fee: {
      enabled: true,
      feeCollector: OPERATOR_FEE_COLLECTOR, // your address, disclosed in ToS
      feeBasisPoints: 10, // 0.1%, capped at 1% by the library
    },
    logger: (m) => console.info(`[customer:${customer.id}] ${m}`),
  });
}
