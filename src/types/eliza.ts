/**
 * Minimal structural mirrors of the shapes exported by `@elizaos/core`.
 *
 * They are declared locally so this package type-checks and tests standalone
 * without pulling the full framework as a hard build dependency. At integration
 * time `@elizaos/core` is a peer dependency; keep these aligned with the version
 * you target. Only the fields this plugin actually touches are modeled.
 */

export interface AgentRuntimeLike {
  getSetting?(key: string): string | undefined;
}

export interface Action {
  name: string;
  similes?: string[];
  description: string;
  validate: (runtime: AgentRuntimeLike, message: unknown) => Promise<boolean>;
  handler: (
    runtime: AgentRuntimeLike,
    message: unknown,
    state?: unknown,
    options?: Record<string, unknown>,
  ) => Promise<unknown>;
  examples?: unknown[];
}

export interface Provider {
  name?: string;
  get: (runtime: AgentRuntimeLike, message: unknown, state?: unknown) => Promise<unknown>;
}

export interface Plugin {
  name: string;
  description: string;
  actions?: Action[];
  providers?: Provider[];
  evaluators?: unknown[];
}
