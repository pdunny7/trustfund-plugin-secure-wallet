# @trustfund/plugin-secure-wallet

Spending guardrails and an **opt-in, transparent, self-directed** convenience fee
for autonomous agent wallets in the [Eliza](https://github.com/elizaOS/eliza)
framework. Built with TypeScript + [viem](https://viem.sh). No custom smart
contracts — fee distribution is done natively with account-abstraction
(ERC-4337 / EIP-7702) atomic multi-call batching.

## Fee disclosure — read this first

This package can charge a convenience fee. Everything about how it does that is
designed so it can never be hidden or misdirected:

| Property | Guarantee |
| --- | --- |
| **Off by default** | `fee.enabled` is `false` unless you set it. With fees off, every transfer is a single unmodified call. |
| **No default recipient** | There is **no hardcoded `feeCollector`**. If you enable fees, the money can only go to an address *you* supply. The code is structurally incapable of routing to the plugin author or any third party. |
| **Bounded** | The fee is hard-capped at `MAX_FEE_BASIS_POINTS = 100` (1%). Anything higher throws at config time. |
| **Self-disclosing** | Enabling fees logs a disclosure at startup and a per-transaction disclosure on every fee-bearing transfer. |
| **Your duty to your users** | If your agent acts on behalf of end users, **you are responsible for disclosing this fee to them.** The fee is deducted from the transfer amount, so the counterparty receives less — say so, up front, wherever your users agree to your terms. |

If you want a pure security plugin with no monetization, just leave fees
disabled — the guardrails work exactly the same.

## Why this exists (and how it's distributed)

Autonomous agents are routinely funded by handing them a private key. A prompt
injection, a logic loop, or a plain bug can then drain the whole treasury. This
plugin adds **per-transaction limits, a recipient allowlist, and a multi-sig
override** so an agent can't move more than you allow or pay someone you didn't
approve.

Distribution is by being genuinely useful and honest about it — published as a
clearly-named standalone package whose docs lead with the fee mechanism. If it's
ever contributed upstream, the pull request discloses the fee up front with fees
**off by default**, so maintainers and downstream users make an informed choice.
It is explicitly **not** designed to embed a hidden take-rate into a shared
dependency that other people's transactions would silently pay.

## Install

```bash
npm install @trustfund/plugin-secure-wallet viem
# @elizaos/core is an optional peer dep, needed only for framework integration
```

## Usage

```ts
import {
  createSecureWalletPlugin,
  type SmartAccountClient,
} from '@trustfund/plugin-secure-wallet';

// You supply a concrete AA client (Biconomy, ZeroDev, permissionless.js, ...).
// Passing an array to sendTransaction MUST execute as one atomic batch.
declare const smartAccountClient: SmartAccountClient;

const plugin = createSecureWalletPlugin({
  wallet: { client: smartAccountClient, chainId: 8453 /* Base */ },

  guardrails: {
    maxTransactionRaw: '500',          // reject transfers over 500 (token units)
    recipientAllowlist: null,          // null = any recipient; or provide Address[]
    requireOverrideAboveLimit: true,   // allow over-limit ONLY with a valid override
  },

  // Fees OFF — the default. Omit or set enabled:false to charge nothing.
  fee: {
    enabled: false,
    feeCollector: null,
    feeBasisPoints: 0,
  },
});
```

To monetize, enable fees and point them at **your own** collector address:

```ts
fee: {
  enabled: true,
  feeCollector: '0xYourOwnCollectorAddress...', // required when enabled
  feeBasisPoints: 10,                            // 0.1% (max 100 = 1%)
}
```

### Executing a transfer

The `SECURE_TRANSFER` action expects a structured intent under `options.intent`:

```ts
const result = await action.handler(runtime, message, state, {
  intent: {
    tokenAddress: null,               // null = native token; else ERC20 address
    targetRecipient: '0xRecipient...',
    totalAmountRaw: '100',
    decimals: 18,
  },
  // Optional multi-sig override to exceed a limit / bypass the allowlist:
  // override: { approved: true, signatures: ['0x...'], threshold: 2 },
});
// result.hash        -> batch tx hash
// result.disclosure  -> fee disclosure string, or null if no fee applied
```

You can also use the pure core directly, without Eliza:

```ts
import { prepareSecureTransfer, executeAtomicBatch } from '@trustfund/plugin-secure-wallet';

const prepared = prepareSecureTransfer(intent, feeConfig, guardrails, override);
if (prepared.disclosure) console.info(prepared.disclosure);
await executeAtomicBatch(smartAccountClient, prepared.split.calls);
```

## Fee math

Pure BigInt, floor division, so fractional dust always stays with the user and
no rounding can underflow a transfer:

```
feeAmount  = floor(totalAmount * feeBasisPoints / 10_000)
userAmount = totalAmount - feeAmount        // userAmount + feeAmount === totalAmount
```

If the amount is small enough that the fee floors to `0`, no fee call is emitted
and the user keeps everything.

## Scripts

```bash
npm run typecheck   # tsc --noEmit, strict
npm test            # vitest run
npm run build       # emit dist/
```

## Commercial / hosted service (open-core)

This plugin is free and MIT-licensed forever — self-host it with fees disabled
and you pay nothing. Revenue for the maintainer comes from **operating** a hosted
secured-wallet service for customers who knowingly sign up and agree to a
disclosed convenience fee, plus a paid control plane (policy dashboard, multi-sig
approval UX, monitoring, audit logs). See [SERVICE.md](SERVICE.md) for the full
architecture and [examples/hosted-operator.ts](examples/hosted-operator.ts) for
the operator-side wiring. The rule that never changes: you only ever charge your
own signed-up customers, transparently.

## Funding

Agent-treasury security is a fundable public good — ecosystem grants (Base,
Optimism RetroPGF, Arbitrum), framework bounties, and GitHub Sponsors (see
[.github/FUNDING.yml](.github/FUNDING.yml)) all apply.

## License

MIT
