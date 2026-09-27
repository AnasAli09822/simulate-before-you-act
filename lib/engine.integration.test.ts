import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { getPool } from "./db";
import { executeSimulation, getState, resetDemo, rollbackExecution, simulate } from "./engine";

const enabled = Boolean(process.env.DATABASE_URL);
const describeDb = enabled ? describe : describe.skip;

const unsafePlan = {
  action: "delete_customers" as const,
  filters: {
    inactive_days: 365,
    exclude_active_subscriptions: false,
    exclude_enterprise: false,
    limit: null,
    chaos_only: false,
  },
};

const safePlan = {
  ...unsafePlan,
  filters: { ...unsafePlan.filters, exclude_active_subscriptions: true },
};

const chaosPlan = {
  ...unsafePlan,
  filters: { ...unsafePlan.filters, chaos_only: true },
};

describeDb("Foresee PostgreSQL safety engine", () => {
  afterAll(async () => {
    await getPool().end();
  });

  it("simulates a real destructive mutation and leaves persistent business state unchanged", async () => {
    const sessionId = randomUUID();
    const before = await resetDemo(sessionId);
    const report = await simulate(sessionId, unsafePlan);
    const after = await getState(sessionId);

    expect(before.customers).toHaveLength(6);
    expect(after.customers).toHaveLength(6);
    expect(report.risk.level).toBe("HIGH");
    expect(report.business_impact.active_subscriptions).toBe(1);
    expect(report.business_impact.mrr_at_risk).toBe(2400);
    expect(report.policy.approval_allowed).toBe(false);
    expect(report.diff.customers.delta).toBe(-4);
  });

  it("re-simulates a safer tweak, commits the exact approved plan, then really rolls it back", async () => {
    const sessionId = randomUUID();
    await resetDemo(sessionId);

    const unsafe = await simulate(sessionId, unsafePlan);
    const safe = await simulate(sessionId, safePlan);

    expect(unsafe.risk.level).toBe("HIGH");
    expect(safe.risk.level).toBe("LOW");
    expect(unsafe.business_impact.mrr_at_risk).toBe(2400);
    expect(safe.business_impact.mrr_at_risk).toBe(0);
    expect(safe.direct_impact.customers).toBe(3);
    expect(safe.policy.approval_allowed).toBe(true);

    const executed = await executeSimulation(sessionId, safe.simulation_id);
    expect(executed.status).toBe("COMPLETED");
    expect(executed.state.customers).toHaveLength(3);

    const rolledBack = await rollbackExecution(sessionId, executed.execution_id);
    expect(rolledBack.status).toBe("ROLLED_BACK");
    expect(rolledBack.state.customers).toHaveLength(6);
    expect(rolledBack.state.account_summary?.enterprise_customers).toBe(1);
    expect(rolledBack.state.account_summary?.mrr).toBe(3300);
  });

  it("blocks stale approval when relevant state changes after simulation", async () => {
    const sessionId = randomUUID();
    await resetDemo(sessionId);
    const safe = await simulate(sessionId, safePlan);
    const targetId = safe.impacted_customers[0]?.id;
    expect(targetId).toBeTruthy();

    await getPool().query(
      `UPDATE customers SET updated_at = updated_at + interval '1 second' WHERE session_id=$1 AND id=$2`,
      [sessionId, targetId],
    );

    const executed = await executeSimulation(sessionId, safe.simulation_id);
    expect(executed.status).toBe("BLOCKED");
    expect(executed.reason).toContain("State changed since simulation");
    expect(executed.state.customers).toHaveLength(6);
  });

  it("catches an under-predicted trigger side effect and rolls back before commit", async () => {
    const sessionId = randomUUID();
    await resetDemo(sessionId);
    const before = await getState(sessionId);
    const report = await simulate(sessionId, chaosPlan);

    expect(report.risk.level).toBe("MEDIUM");
    expect(report.policy.approval_allowed).toBe(true);
    expect(report.direct_impact.customers).toBe(1);

    const executed = await executeSimulation(sessionId, report.simulation_id);
    expect(executed.status).toBe("BLOCKED");
    expect(executed.reason).toContain("Simulation divergence detected");
    expect(executed.divergence?.deviations?.join(" ")).toContain("account_summary.enterprise_customers");

    const after = executed.state;
    expect(after.customers).toHaveLength(before.customers.length);
    expect(after.account_summary?.enterprise_customers).toBe(before.account_summary?.enterprise_customers);
    expect(after.account_summary?.mrr).toBe(before.account_summary?.mrr);
  });
});
