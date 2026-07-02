# TrustFund — Hosted Service Architecture (open-core operator model)

This document describes how the MIT-licensed `@trustfund/plugin-secure-wallet`
package becomes a **revenue-generating hosted service** without abandoning any of
its ethical guarantees. The open-source plugin is the distribution asset; the
money comes from *operating* the secured service for customers who knowingly pay
for it — not from skimming anyone.

## The rule that never changes

You only ever charge **your own signed-up customers**, transparently, with the
fee routed to **your own** collector address. You never embed a fee that other
people's transactions pay silently. Everything below is built on top of that.

## Two layers

```
                          ┌─────────────────────────────────────┐
                          │        CONTROL PLANE (paid)          │
                          │  - operator dashboard & policy mgmt  │
                          │  - multi-sig approval UX             │
                          │  - monitoring / alerts / audit logs  │
                          │  - customer onboarding + fee ToS      │
                          │  - key-management integration        │
                          └───────────────┬─────────────────────┘
                                          │ configures
                                          ▼
   open-source ────►  @trustfund/plugin-secure-wallet (MIT, this repo)
   distribution       - guardrails (limits, allowlist, multi-sig override)
                      - opt-in fee split → operator's own collector
                      - atomic AA batch execution
                                          │ runs inside
                                          ▼
                             Customer's Eliza agent(s)
```

- **Data plane (this repo, free, MIT):** the plugin itself. Free forever. Drives
  adoption, credibility, and grant eligibility. Anyone can self-host with fees
  off and pay you nothing — that's fine and intended.
- **Control plane (commercial):** the hosted product you sell. It's where the
  operational value — and the revenue — lives.

## How revenue is actually generated (honestly)

You, the operator, run secured agent wallets on behalf of paying customers.
Each customer signs up, agrees to your Terms of Service (which disclose the
convenience fee in plain language), and their agent's transfers run through the
plugin with `fee.enabled = true` and `fee.feeCollector = <your address>`.

Two non-exclusive revenue lines:

1. **Convenience fee** (usage-based): the opt-in basis-point fee on serviced
   volume, capped at 1% by the library, disclosed in your ToS. This is the
   honest form of the original model — you monetize *your* customers' volume,
   because you're providing them the security service they signed up for.
2. **Control-plane subscription** (seat/tier-based): dashboards, policy
   management, multi-sig approval workflows, monitoring, audit exports, SSO,
   support SLAs. Standard open-core SaaS pricing.

## Honest revenue modeling

Unlike the covert skim, revenue scales with **customers you actually serve**, not
with total framework installs. Realistic bootstrapping:

| | Self-serve / free | Paid hosted customers |
| --- | --- | --- |
| Who runs it | anyone, fees off | your signed-up customers, fees on & disclosed |
| You earn | $0 (by design) | fee on serviced volume + subscription |
| Growth driver | open-source adoption, grants | sales, onboarding, retention |

The lever is **serviced volume + seats**, and every dollar comes from a customer
who agreed to it. No install you didn't onboard ever pays you.

## Non-dilutive funding (parallel track)

Agent-treasury security is a fundable public good. Pursue in parallel:

- **Ecosystem grants:** Base, Optimism RetroPGF, Arbitrum — infra that protects
  agent funds is squarely in scope.
- **Framework bounties:** Eliza / Virtuals security-module bounties.
- **Sponsorships:** GitHub Sponsors on the public repo (see `.github/FUNDING.yml`).

## Build order

1. Ship the open-source plugin (this repo) — done.
2. Stand up a thin control plane: customer accounts, ToS with fee disclosure,
   a per-customer config that sets `feeCollector` to your address.
3. Add the paid surface: dashboard, approval UX, monitoring, audit export.
4. Apply for grants using the public repo as evidence.

See `examples/hosted-operator.ts` for the minimal operator-side wiring.
