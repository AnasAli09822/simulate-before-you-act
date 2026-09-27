# Foresee — Challenge Compliance Matrix

This file separates implemented/verified behavior from deployment-dependent acceptance items. Nothing is marked complete solely because code exists.

| Requirement | Implementation / evidence | Status |
|---|---|---|
| Public repository | `AnasAli09822/simulate-before-you-act` | ✅ |
| Clean install/build | GitHub Actions performs fresh checkout + install + typecheck + production build | ✅ |
| Real PostgreSQL world model | CI boots PostgreSQL 16 and runs the safety engine against it | ✅ |
| Constrained action DSL | `lib/core.ts`, `app/api/foresee/route.ts` | ✅ |
| Real destructive DELETE | `lib/engine.ts` executes the candidate DELETE in PostgreSQL | ✅ |
| Simulation before mutation authority | `REPEATABLE READ` simulation transaction executes then rolls back | ✅ |
| Simulation leaves persistent business state unchanged | PostgreSQL integration test compares six seeded customers before/after simulation | ✅ |
| Before/after diff | Measured database state shown in review UI | ✅ |
| Impacted customers visible | Exact target rows rendered in review UI | ✅ |
| Business impact visible | Active subscriptions, MRR, Enterprise accounts, tickets, notes | ✅ |
| Rollback plan visible before approval | Row counts + journal strategy + fingerprint in review UI | ✅ |
| Approve / Tweak / Reject | Single review decision bar | ✅ |
| Simulation changes decision | Unsafe plan is HIGH / $2,400 MRR / blocked; exclusion tweak becomes LOW / $0 | ✅ |
| State fingerprint prevents stale execution | SHA-256 plan/state vector, target-ID equality, row locking | ✅ |
| Approved action really executes | PostgreSQL integration + browser acceptance test | ✅ |
| Actual rollback works | Ordered rollback journal restores parent/dependent rows | ✅ |
| Runtime safety verifier | Observed world + account summary checked before commit | ✅ |
| Required under-prediction failure | `chaos_case` hidden PostgreSQL trigger | ✅ |
| Failure auto-caught | Divergence test expects `account_summary.enterprise_customers` mismatch | ✅ |
| Failure persistent state safe | Execution transaction rolls back; integration/browser tests assert unchanged state | ✅ |
| Audit timeline visible | `audit_events` + live timeline | ✅ |
| Architecture snapshot | `docs/ARCHITECTURE.md` and live `ArchitecturePanel` | ✅ |
| Two-year thesis ≤300 words | README | ✅ |
| AI tools documented honestly | README | ✅ |
| Key decisions + out of scope | README | ✅ |
| Main browser E2E | `e2e/foresee.spec.ts` | ✅ |
| Failure browser E2E | `e2e/foresee.spec.ts` | ✅ |
| Production dependency security gate | `npm audit --omit=dev --audit-level=high` in CI | ✅ |
| No secrets in repository | `.env.example` contains placeholder only | ✅ |
| Live public deployment without auth | Requires hosted PostgreSQL binding + deployment verification | ⏳ |
| Live app uses hosted PostgreSQL/Neon equivalent | Requires hosted database connection | ⏳ |
| Public deployment manually/browser verified | Requires live URL | ⏳ |
| 90-second recorded walkthrough | Script exists at `docs/DEMO_SCRIPT.md`; recording not created | ⏳ |

## Automated acceptance journeys

### Main reviewer journey

1. open Foresee with a fresh browser session;
2. simulate inactivity deletion;
3. assert HIGH risk, Atlas Enterprise, and $2,400 MRR exposure;
4. assert approval is blocked;
5. apply **Exclude active subscriptions**;
6. assert LOW risk and $0 MRR exposure;
7. approve the exact simulation;
8. assert committed execution;
9. run actual rollback;
10. assert the six-customer seed state is restored.

### Failure journey

1. open a fresh browser session;
2. run the deterministic failure test;
3. approve the MEDIUM-risk simulation;
4. hidden trigger changes `account_summary` during candidate execution;
5. runtime verifier detects the unpredicted change;
6. transaction is rolled back automatically;
7. UI reports `EXECUTION BLOCKED` and `Persistent state: UNCHANGED`;
8. database still exposes six customers and $3,300 protected MRR.

## CI gates

The `CI` workflow must pass all of the following on `main`:

```text
PostgreSQL service ready
→ npm install
→ 8 unit/integration tests
→ strict TypeScript
→ Next.js production build
→ high/critical production dependency audit
→ Chromium install
→ 2 browser acceptance journeys
```

Deployment-only items remain intentionally unmarked until they are exercised through the public URL.
