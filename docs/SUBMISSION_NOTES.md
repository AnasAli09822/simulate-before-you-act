# Submission Notes — Simulate Before You Act

## What to look at

Foresee's simulation is an actual reversible database state transition, not an LLM-generated explanation. The system executes the proposed DELETE against real PostgreSQL state inside a transaction, measures the consequences, and rolls the transaction back before human review.

The most important demo moment is the first simulation changing the decision: an inactivity-only deletion unexpectedly targets an inactive Enterprise customer that still carries an active $2,400 MRR subscription. Foresee blocks approval. A bounded tweak excludes active subscriptions, re-runs the simulation, and removes the protected revenue from the blast radius.

## Safety design

- constrained action DSL rather than arbitrary SQL,
- server-side parameterized query compilation,
- real transactional simulation,
- row-level and aggregate before/after diff,
- deterministic policy/risk factors,
- SHA-256 state fingerprint to prevent stale approval,
- execution of the immutable stored simulation only,
- ordered rollback journal,
- post-action runtime divergence detection before commit,
- session-isolated, resettable public demo state.

## Failure test

The failure path deliberately makes the simulator incomplete. A hidden PostgreSQL trigger associated with the `chaos_case` row modifies `account_summary`, while the simulation model omits that dependency. During execution, the broader verifier observes the unpredicted state mutation and automatically rolls back the transaction. The failure is evidence for the architecture: simulation is useful without pretending to be omniscient because runtime verification bounds prediction error.

## AI tools used

OpenAI ChatGPT was used for architecture work, implementation, code review, challenge mapping, documentation, and connected-tool operations during development. Foresee does not use an LLM to invent impact numbers; all displayed database impact is calculated from transactional PostgreSQL state.

## Key decisions

One deep destructive-database adapter was chosen over multiple shallow integrations. The public demo exposes no arbitrary SQL and needs no reviewer authentication. Each browser session is data-isolated. Approval is against one exact simulation, not against editable frontend parameters. The runtime verifier is deliberately separate from the simulation model so it can catch the simulator's own mistakes.

## Out of scope

General-purpose SQL execution, additional external-action adapters, production RBAC, and replaying arbitrary external SaaS side effects are intentionally outside this challenge build.
