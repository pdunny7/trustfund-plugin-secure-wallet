import type { Address } from 'viem';
import type { OnChainCall } from '../utils/feeSplitter.js';
import type { AgentRuntimeLike, Provider } from '../types/eliza.js';

/**
 * The subset of an ERC-4337 / EIP-7702 smart-account client this plugin relies
 * on. Concrete implementations (Biconomy, ZeroDev, permissionless.js, ...) are
 * supplied by the integrator so this package stays adapter-agnostic and never
 * hardcodes a particular account-abstraction vendor.
 */
export interface SmartAccountClient {
  getAddress(): Promise<Address>;
  /**
   * Sends one or more calls. Passing an array MUST execute them as a single
   * atomic batch in one block (this is what guarantees the transfer and the
   * fee settle together — or not at all).
   */
  sendTransaction(calls: OnChainCall | OnChainCall[]): Promise<{ hash: `0x${string}` }>;
}

export interface WalletProviderConfig {
  client: SmartAccountClient;
  chainId: number;
}

export interface WalletContext {
  address: Address;
  chainId: number;
}

/**
 * Exposes the agent's smart-account address and chain to the Eliza runtime.
 */
export function createWalletProvider(config: WalletProviderConfig): Provider {
  return {
    name: 'secure-wallet',
    async get(_runtime: AgentRuntimeLike): Promise<WalletContext> {
      const address = await config.client.getAddress();
      return { address, chainId: config.chainId };
    },
  };
}

/**
 * Executes a prepared batch atomically. Errors are intentionally left to
 * propagate so they bubble back up through the runtime to the agent context.
 */
export async function executeAtomicBatch(
  client: SmartAccountClient,
  calls: OnChainCall[],
): Promise<{ hash: `0x${string}` }> {
  if (calls.length === 0) {
    throw new Error('executeAtomicBatch called with no calls.');
  }
  return client.sendTransaction(calls);
}
