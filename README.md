# Foresee

**See the consequences before your agent acts.**

Foresee is a simulation gateway for high-stakes agent writes. It does not ask an LLM to imagine the result of a database mutation; it runs the candidate mutation against real PostgreSQL state inside a reversible transaction, measures the state transition, rolls it back, and only then lets a human approve the exact simulated plan.

> Thesis: authority should be granted against a concrete projected state transition, not merely against an agent's intent.

## Challenge

Built for **Doo — Simulate Before You Act**. The demo focuses on one production-grade adapter: destructive PostgreSQL customer deletion.

Example intent:

> Delete customers inactive for more than 12 months.

The baseline simulation deliberately reveals that one inactive customer still has an active Enterprise subscription worth **$2,400 MRR**. The reviewer can apply **Exclude active subscriptions**, re-simulate, and watch risk move from HIGH to LOW before approval.

## How the simulation actually works

1. The UI produces a constrained DSL, never arbitrary SQL.
2. The server validates the DSL with Zod and compiles it to parameterized PostgreSQL queries.
3. Foresee opens a `REPEATABLE READ` transaction.
4. It resolves the exact target rows and dependency impact.
5. It executes the real `DELETE` inside that transaction.
6. It measures the projected post-action state.
7. It `ROLLBACK`s the entire simulation transaction.
8. It stores a simulation report, affected IDs, state vector, expiration, policy result, and SHA-256 state fingerprint.
9. Approval executes only the immutable stored plan associated with that simulation ID.
10. Execution uses a `SERIALIZABLE` transaction, locks/revalidates the target state, creates an ordered rollback journal, performs the mutation, and runs post-action invariants before `COMMIT`.

Simulation changes the decision; it is not an “Are you sure?” dialog.

## Architecture

```text
User / Agent
     │
     ▼
Intent → Validated Action DSL
     │
     ▼
Simulation Engine
 ├─ real PostgreSQL transaction
 ├─ impact graph
 ├─ deterministic risk + policy
 ├─ uncertainty / coverage
 └─ rollback planning
     │
     ▼
Simulation Report
     │
     ▼
Human Review ── Reject / Tweak / Approve
                         │
                         ▼
Execution Gateway
 ├─ fingerprint revalidation
 ├─ row locks
 ├─ rollback journal
 └─ exact approved mutation
                         │
                         ▼
Runtime Safety Net
       ┌─────────────────┴─────────────────┐
       ▼                                   ▼
    match                               divergence
       │                                   │
     COMMIT                              ROLLBACK
       │                                   │
       ▼                                   ▼
   audit log                         failure report
```

See `docs/ARCHITECTURE.md` for the submission snapshot.

## Safety architecture

### Constrained action DSL

```json
{
  "action": "delete_customers",
  "filters": {
    "inactive_days": 365,
    "exclude_active_subscriptions": false,
    "exclude_enterprise": false,
    "limit": null,
    "chaos_only": false
  }
}
```

No browser path can submit SQL.

### State fingerprint

The simulation fingerprint covers the normalized plan plus the exact targeted rows and relevant mutable state: row timestamps, active-subscription count/MRR, ticket count, and note count. Approval is rejected when this state differs from what was simulated.

### Rollback journal

Before an approved destructive execution, Foresee snapshots parent and dependent rows into `rollback_snapshots` with restore order. A committed deletion can therefore be reversed by the real **Rollback execution** control.

### Runtime verification

Simulation predicts. Runtime verification confirms. Execution is committed only when observed state remains inside the approved impact envelope.

## Failure test

The demo contains one `chaos_case` customer and a PostgreSQL trigger that mutates `account_summary.enterprise_customers` when that row is deleted.

The simulation intentionally does **not** include this trigger effect in its dependency model. It predicts the customer deletion while `account_summary` remains unchanged. During real execution the broader verifier observes the unexpected summary mutation, reports **SIMULATION_DIVERGENCE**, and rolls the transaction back before commit. Persistent business state therefore remains unchanged.

This is deliberate: Foresee does not pretend its world model is omniscient.

## Session-isolated public demo

Every browser receives a UUID `session_id`. All business rows, simulations, executions, snapshots, and audit events are scoped to that session. **Reset demo** reseeds only that session. Reviewers do not need authentication and cannot issue arbitrary deletes.

## Data model

- `demo_sessions`
- `customers`
- `subscriptions`
- `support_tickets`
- `customer_notes`
- `account_summary`
- `simulation_runs`
- `execution_runs`
- `rollback_snapshots`
- `audit_events`

The canonical schema is in `db/schema.sql`.

## Tech stack

- Next.js App Router
- React + TypeScript (strict)
- PostgreSQL via `pg`
- Zod validation
- Vitest
- GitHub Actions
- Vercel target deployment

## Local setup

```bash
git clone https://github.com/AnasAli09822/simulate-before-you-act.git
cd simulate-before-you-act
npm install
cp .env.example .env.local
# Set DATABASE_URL to a PostgreSQL database.
npm run dev
```

The application bootstraps the challenge schema on the first demo request. `db/schema.sql` is also provided for inspection/manual setup.

## Testing

```bash
npm test
npm run typecheck
npm run build
```

CI runs all three commands on every push to `main`.

Core tests cover deterministic risk reduction, confidence/coverage behavior, and stable fingerprints. The final acceptance path also requires deployed E2E verification of the normal and divergence flows.

## 90-second demo flow

The executable script is in `docs/DEMO_SCRIPT.md`.

1. Start at the review surface and run the 12-month deletion simulation.
2. Show that PostgreSQL reports an inactive Enterprise customer with active $2,400 MRR; risk is HIGH and approval is blocked.
3. Click **Tweak: exclude active subscriptions**.
4. Re-simulate; protected subscription impact and MRR risk become zero; risk becomes LOW.
5. Approve the exact plan; fingerprint validation and runtime verification pass.
6. Use **Rollback execution** to restore deleted rows.
7. Run **Failure test**, approve it, and show the hidden trigger creating an unpredicted `account_summary` change.
8. Show **EXECUTION BLOCKED** and persistent state **UNCHANGED**.

## AI tools used

OpenAI ChatGPT was used during implementation for architecture, code generation/review, challenge mapping, documentation, and tool-driven GitHub/deployment work. Database impact values in the product are **not** generated by an LLM; they are measured from PostgreSQL transactions.

## Key decisions

- One deep destructive-database adapter instead of several shallow integrations.
- Real database state is the world model.
- DSL → validation → parameterized SQL; never model-generated arbitrary SQL.
- Initial HIGH-risk simulation is policy-blocked until the reviewer changes the plan.
- Fingerprint revalidation prevents simulate-then-execute drift.
- Rollback snapshots are persisted only for successfully committed execution paths.
- The failure test makes the simulator wrong on purpose; runtime verification is the second safety layer.
- No authentication in the challenge demo; isolation is by resettable session sandbox.

## Out of scope

- General-purpose arbitrary SQL execution.
- Multiple external-action adapters.
- External SaaS/webhook replay inside the simulation transaction.
- Production identity/RBAC and multi-organization authorization.
- Claims that unknown external side effects can be perfectly predicted.

## Two-year thesis

Today, agent systems are usually evaluated on whether they can complete a task. That criterion breaks down once agents can write to production databases, move money, change infrastructure, or communicate as a company. Successful execution is not enough; the operational question becomes: **what world exists after this action?**

Over the next two years, simulation should become a standard protocol between intent and authority. An agent asking for permission to perform a consequential write should first produce a bounded projected state transition: affected entities, blast radius, protected relationships, uncertainty, and a concrete rollback path. Authority can then be granted to that specific transition rather than to a vague natural-language instruction.

The critical point is that simulation will never be perfectly accurate. World models omit triggers, integrations, race conditions, and behavior outside their observation boundary. Simulation therefore has to be paired with runtime verification. The executor must compare observed reality against the approved impact envelope and automatically stop or reverse the mutation when the two diverge.

The useful trust boundary is consequently not “Can this agent call this tool?” It is: **Can this agent produce this specific, simulated state transition under these constraints, and can the system prove execution stayed inside it?**

The winning agent infrastructure will combine prediction, scoped authority, fingerprints, runtime invariants, and rollback—not merely an undo button after an unsafe action has already escaped.

## Status

Repository implementation is public. Live-demo URL and deployed acceptance evidence are added only after the hosted PostgreSQL binding and production verification pass; this README does not claim unverified deployment behavior.
