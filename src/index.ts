import type { Address } from 'viem';
import {
  validateFeeConfig,
  type FeeSplitConfig,
  type TransactionIntent,
} from './utils/feeSplitter.js';
import {
  prepareSecureTransfer,
  type GuardrailConfig,
  type OverrideApproval,
} from './actions/transfer.js';
import {
  createWalletProvider,
  executeAtomicBatch,
  type WalletProviderConfig,
} from './providers/wallet.js';
import type { Action, AgentRuntimeLike, Plugin } from './types/eliza.js';

export interface SecureWalletPluginConfig {
  fee: FeeSplitConfig;
  guardrails: GuardrailConfig;
  wallet: WalletProviderConfig;
  /** Optional sink for disclosures/warnings. Defaults to console. */
  logger?: (message: string) => void;
}

/**
 * Payload the transfer action expects under `options.intent`, plus an optional
 * multi-sig override.
 */
export interface TransferActionOptions {
  intent: TransactionIntent;
  override?: OverrideApproval;
}

function defaultLogger(message: string): void {
  // eslint-disable-next-line no-console
  console.info(`[plugin-secure-wallet] ${message}`);
}

/**
 * Emits a one-time, unmissable disclosure when fees are active so no deployer
 * can enable a fee without it being logged, and to remind them that disclosing
 * the fee to their own end users is their responsibility.
 */
function announceFeePosture(config: FeeSplitConfig, log: (m: string) => void): void {
  if (!config.enabled || config.feeBasisPoints <= 0 || config.feeCollector === null) {
    log('Convenience fee is DISABLED. No fee will be deducted from any transfer.');
    return;
  }
  const pct = config.feeBasisPoints / 100;
  log(
    `Convenience fee is ENABLED: ${config.feeBasisPoints} bps (${pct}%), routed to ${config.feeCollector}. ` +
      'You (the deployer) are responsible for disclosing this fee to your own users.',
  );
}

function buildTransferAction(
  config: SecureWalletPluginConfig,
  log: (m: string) => void,
): Action {
  return {
    name: 'SECURE_TRANSFER',
    similes: ['TRANSFER', 'SEND_TOKENS', 'PAY'],
    description:
      'Executes a guardrailed token/native transfer as an atomic batch, applying the ' +
      'deployer-configured convenience fee (if any) transparently.',
    async validate(_runtime: AgentRuntimeLike, _message: unknown): Promise<boolean> {
      return true;
    },
    async handler(
      _runtime: AgentRuntimeLike,
      _message: unknown,
      _state?: unknown,
      options?: Record<string, unknown>,
    ): Promise<{ hash: `0x${string}`; disclosure: string | null }> {
      const opts = options as TransferActionOptions | undefined;
      if (!opts?.intent) {
        throw new Error('SECURE_TRANSFER requires options.intent (a TransactionIntent).');
      }

      // Guardrails + fee split. Any GuardrailError/FeeConfigError here bubbles
      // straight up through the runtime, as required.
      const prepared = prepareSecureTransfer(
        opts.intent,
        config.fee,
        config.guardrails,
        opts.override,
      );

      if (prepared.disclosure) {
        log(prepared.disclosure);
      }

      const receipt = await executeAtomicBatch(config.wallet.client, prepared.split.calls);
      return { hash: receipt.hash, disclosure: prepared.disclosure };
    },
  };
}

/**
 * Creates the secure-wallet plugin. Fails fast on invalid fee configuration and
 * announces its fee posture at construction time.
 */
export function createSecureWalletPlugin(config: SecureWalletPluginConfig): Plugin {
  const log = config.logger ?? defaultLogger;

  // Fail fast: a broken/over-cap fee config should never reach production.
  validateFeeConfig(config.fee);
  announceFeePosture(config.fee, log);

  return {
    name: 'plugin-secure-wallet',
    description:
      'Opt-in spending guardrails and a transparent, self-directed convenience fee for ' +
      'autonomous agent wallets. No fees by default; no hardcoded fee recipient.',
    actions: [buildTransferAction(config, log)],
    providers: [createWalletProvider(config.wallet)],
    evaluators: [],
  };
}

export default createSecureWalletPlugin;

// Public surface.
export {
  computeFeeSplit,
  validateFeeConfig,
  FeeConfigError,
  MAX_FEE_BASIS_POINTS,
  ERC20_ABI,
  type FeeSplitConfig,
  type FeeSplitResult,
  type TransactionIntent,
  type OnChainCall,
} from './utils/feeSplitter.js';
export {
  prepareSecureTransfer,
  assertWithinGuardrails,
  GuardrailError,
  type GuardrailConfig,
  type OverrideApproval,
  type PreparedTransfer,
} from './actions/transfer.js';
export {
  createWalletProvider,
  executeAtomicBatch,
  type SmartAccountClient,
  type WalletProviderConfig,
  type WalletContext,
} from './providers/wallet.js';
export type { Action, Plugin, Provider, AgentRuntimeLike } from './types/eliza.js';

export type { Address };
