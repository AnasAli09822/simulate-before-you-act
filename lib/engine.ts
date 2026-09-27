import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { actionPlanSchema, confidence, deriveRisk, fingerprint, normalizePlan, type ActionPlan } from "@/lib/core";
import { getPool, withClient } from "@/lib/db";
import { SCHEMA_SQL } from "@/lib/schema";

const msDay = 86_400_000;
const num = (value: unknown) => Number(value ?? 0);
const json = (value: unknown) => JSON.stringify(value);

export async function ensureSchema() {
  await getPool().query(SCHEMA_SQL);
}

async function audit(client: PoolClient, sessionId: string, eventType: string, detail: unknown = {}, simulationId?: string, executionId?: string) {
  await client.query(
    `INSERT INTO audit_events(id,session_id,event_type,simulation_id,execution_id,detail) VALUES($1,$2,$3,$4,$5,$6::jsonb)`,
    [randomUUID(), sessionId, eventType, simulationId ?? null, executionId ?? null, json(detail)],
  );
}

function customerSeed(sessionId: string) {
  const now = Date.now();
  return [
    { id: randomUUID(), sessionId, name: "Acme Archive", email: "ops@acme-archive.test", status: "inactive", days: 520, segment: "Starter" },
    { id: randomUUID(), sessionId, name: "Northwind Labs", email: "team@northwind-labs.test", status: "inactive", days: 620, segment: "Pro" },
    { id: randomUUID(), sessionId, name: "Atlas Enterprise", email: "it@atlas-enterprise.test", status: "inactive", days: 430, segment: "Enterprise" },
    { id: randomUUID(), sessionId, name: "Solstice Studio", email: "hello@solstice-studio.test", status: "inactive", days: 390, segment: "Growth" },
    { id: randomUUID(), sessionId, name: "Current Labs", email: "admin@current-labs.test", status: "active", days: 15, segment: "Growth" },
    { id: randomUUID(), sessionId, name: "Chaos Ghost", email: "chaos@hidden-dependency.test", status: "chaos_case", days: 800, segment: "Sandbox" },
  ].map((c) => ({ ...c, lastActive: new Date(now - c.days * msDay) }));
}

export async function resetDemo(sessionId: string) {
  await ensureSchema();
  await withClient(async (client) => {
    await client.query("BEGIN");
    try {
      await client.query(`INSERT INTO demo_sessions(id) VALUES($1) ON CONFLICT(id) DO UPDATE SET updated_at=now()`, [sessionId]);
      await client.query(`DELETE FROM rollback_snapshots WHERE session_id=$1`, [sessionId]);
      await client.query(`DELETE FROM execution_runs WHERE session_id=$1`, [sessionId]);
      await client.query(`DELETE FROM simulation_runs WHERE session_id=$1`, [sessionId]);
      await client.query(`DELETE FROM audit_events WHERE session_id=$1`, [sessionId]);
      await client.query(`DELETE FROM customer_notes WHERE session_id=$1`, [sessionId]);
      await client.query(`DELETE FROM support_tickets WHERE session_id=$1`, [sessionId]);
      await client.query(`DELETE FROM subscriptions WHERE session_id=$1`, [sessionId]);
      await client.query(`DELETE FROM customers WHERE session_id=$1`, [sessionId]);
      await client.query(`DELETE FROM account_summary WHERE session_id=$1`, [sessionId]);

      const customers = customerSeed(sessionId);
      for (const c of customers) {
        await client.query(
          `INSERT INTO customers(id,session_id,name,email,status,last_active_at,segment) VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [c.id, sessionId, c.name, c.email, c.status, c.lastActive, c.segment],
        );
      }
      const byName = new Map(customers.map((c) => [c.name, c.id]));
      const subscriptions = [
        ["Acme Archive", "Starter", "canceled", 0],
        ["Northwind Labs", "Pro", "canceled", 0],
        ["Atlas Enterprise", "Enterprise", "active", 2400],
        ["Solstice Studio", "Growth", "canceled", 0],
        ["Current Labs", "Growth", "active", 900],
      ] as const;
      for (const [name, plan, status, mrr] of subscriptions) {
        await client.query(
          `INSERT INTO subscriptions(id,session_id,customer_id,plan,status,renewal_date,mrr) VALUES($1,$2,$3,$4,$5,current_date+30,$6)`,
          [randomUUID(), sessionId, byName.get(name), plan, status, mrr],
        );
      }
      await client.query(
        `INSERT INTO support_tickets(id,session_id,customer_id,status,priority,subject) VALUES
          ($1,$2,$3,'open','urgent','Enterprise SSO migration'),
          ($4,$2,$5,'closed','low','Historical export')`,
        [randomUUID(), sessionId, byName.get("Atlas Enterprise"), randomUUID(), byName.get("Acme Archive")],
      );
      const noteRows = [
        ["Atlas Enterprise", "Strategic account — renewal conversation active."],
        ["Atlas Enterprise", "Do not remove while Enterprise subscription is active."],
        ["Northwind Labs", "Former evaluation account."],
        ["Solstice Studio", "Inactive after team migration."],
      ] as const;
      for (const [name, content] of noteRows) {
        await client.query(`INSERT INTO customer_notes(id,session_id,customer_id,content) VALUES($1,$2,$3,$4)`, [randomUUID(), sessionId, byName.get(name), content]);
      }
      await client.query(
        `INSERT INTO account_summary(session_id,active_customers,enterprise_customers,mrr)
         SELECT $1,
           count(*) FILTER (WHERE status='active')::int,
           count(*) FILTER (WHERE segment='Enterprise')::int,
           COALESCE((SELECT sum(mrr) FROM subscriptions WHERE session_id=$1 AND status='active'),0)
         FROM customers WHERE session_id=$1`,
        [sessionId],
      );
      await audit(client, sessionId, "DEMO_RESET", { seeded_customers: customers.length });
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
  return getState(sessionId);
}

export async function initDemo(sessionId: string) {
  await ensureSchema();
  const existing = await getPool().query(`SELECT count(*)::int AS count FROM customers WHERE session_id=$1`, [sessionId]);
  if (num(existing.rows[0]?.count) === 0) return resetDemo(sessionId);
  return getState(sessionId);
}

async function worldState(client: PoolClient, sessionId: string) {
  const result = await client.query(
    `SELECT
      (SELECT count(*) FROM customers WHERE session_id=$1)::int AS customers,
      (SELECT count(*) FROM subscriptions WHERE session_id=$1 AND status='active')::int AS active_subscriptions,
      COALESCE((SELECT sum(mrr) FROM subscriptions WHERE session_id=$1 AND status='active'),0)::float8 AS mrr,
      (SELECT count(*) FROM support_tickets WHERE session_id=$1 AND status='open')::int AS open_tickets,
      (SELECT count(*) FROM customer_notes WHERE session_id=$1)::int AS notes`,
    [sessionId],
  );
  const r = result.rows[0];
  return { customers: num(r.customers), active_subscriptions: num(r.active_subscriptions), mrr: num(r.mrr), open_tickets: num(r.open_tickets), notes: num(r.notes) };
}

async function accountSummary(client: PoolClient, sessionId: string) {
  const result = await client.query(`SELECT active_customers,enterprise_customers,mrr::float8 AS mrr FROM account_summary WHERE session_id=$1`, [sessionId]);
  const r = result.rows[0];
  return r ? { active_customers: num(r.active_customers), enterprise_customers: num(r.enterprise_customers), mrr: num(r.mrr) } : null;
}

function targetSql(plan: ActionPlan, lock = false) {
  const p = normalizePlan(plan);
  const values: unknown[] = [];
  const add = (v: unknown) => { values.push(v); return `$${values.length}`; };
  const sessionParam = add("__SESSION__");
  const where: string[] = [`c.session_id=${sessionParam}`];
  if (p.filters.chaos_only) {
    where.push(`c.status='chaos_case'`);
  } else {
    const days = add(p.filters.inactive_days);
    where.push(`c.status<>'chaos_case'`);
    where.push(`c.last_active_at < now() - (${days}::int * interval '1 day')`);
  }
  if (p.filters.exclude_enterprise) where.push(`c.segment<>'Enterprise'`);
  if (p.filters.exclude_active_subscriptions) {
    where.push(`NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.session_id=c.session_id AND s.customer_id=c.id AND s.status='active')`);
  }
  let limit = "";
  if (p.filters.limit) limit = ` LIMIT ${add(p.filters.limit)}::int`;
  return {
    text: `SELECT c.id,c.name,c.email,c.status,c.segment,c.last_active_at,c.updated_at FROM customers c WHERE ${where.join(" AND ")} ORDER BY c.last_active_at,c.id${limit}${lock ? " FOR UPDATE" : ""}`,
    values,
  };
}

async function targetRows(client: PoolClient, sessionId: string, plan: ActionPlan, lock = false) {
  const q = targetSql(plan, lock);
  q.values[0] = sessionId;
  return (await client.query(q.text, q.values)).rows;
}

async function targetVector(client: PoolClient, sessionId: string, ids: string[]) {
  if (!ids.length) return [];
  return (await client.query(
    `SELECT c.id::text,c.updated_at,c.status,c.segment,
      (SELECT count(*)::int FROM subscriptions s WHERE s.session_id=$1 AND s.customer_id=c.id AND s.status='active') AS active_subscriptions,
      (SELECT COALESCE(sum(s.mrr),0)::float8 FROM subscriptions s WHERE s.session_id=$1 AND s.customer_id=c.id AND s.status='active') AS active_mrr,
      (SELECT count(*)::int FROM support_tickets t WHERE t.session_id=$1 AND t.customer_id=c.id) AS tickets,
      (SELECT count(*)::int FROM customer_notes n WHERE n.session_id=$1 AND n.customer_id=c.id) AS notes
     FROM customers c WHERE c.session_id=$1 AND c.id=ANY($2::uuid[]) ORDER BY c.id`,
    [sessionId, ids],
  )).rows;
}

async function impact(client: PoolClient, sessionId: string, ids: string[]) {
  if (!ids.length) return { activeSubscriptions: 0, mrrAtRisk: 0, enterpriseCustomers: 0, openTickets: 0, notes: 0 };
  const r = (await client.query(
    `SELECT
      (SELECT count(*) FROM subscriptions WHERE session_id=$1 AND customer_id=ANY($2::uuid[]) AND status='active')::int AS active_subscriptions,
      COALESCE((SELECT sum(mrr) FROM subscriptions WHERE session_id=$1 AND customer_id=ANY($2::uuid[]) AND status='active'),0)::float8 AS mrr_at_risk,
      (SELECT count(*) FROM customers WHERE session_id=$1 AND id=ANY($2::uuid[]) AND segment='Enterprise')::int AS enterprise_customers,
      (SELECT count(*) FROM support_tickets WHERE session_id=$1 AND customer_id=ANY($2::uuid[]) AND status='open')::int AS open_tickets,
      (SELECT count(*) FROM customer_notes WHERE session_id=$1 AND customer_id=ANY($2::uuid[]))::int AS notes`,
    [sessionId, ids],
  )).rows[0];
  return {
    activeSubscriptions: num(r.active_subscriptions), mrrAtRisk: num(r.mrr_at_risk), enterpriseCustomers: num(r.enterprise_customers), openTickets: num(r.open_tickets), notes: num(r.notes),
  };
}

export async function simulate(sessionId: string, rawPlan: unknown) {
  await ensureSchema();
  const plan = normalizePlan(actionPlanSchema.parse(rawPlan));
  const simulationId = randomUUID();
  const expiresAt = new Date(Date.now() + 10 * 60_000);

  const report = await withClient(async (client) => {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    try {
      const before = await worldState(client, sessionId);
      const predictedSummary = await accountSummary(client, sessionId);
      const targets = await targetRows(client, sessionId, plan);
      const ids = targets.map((r) => String(r.id));
      const targetImpact = await impact(client, sessionId, ids);
      const vector = await targetVector(client, sessionId, ids);
      const stateFingerprint = fingerprint({ plan, vector });
      if (ids.length) await client.query(`DELETE FROM customers WHERE session_id=$1 AND id=ANY($2::uuid[])`, [sessionId, ids]);
      const after = await worldState(client, sessionId);
      await client.query("ROLLBACK");

      const risk = deriveRisk({
        affectedCustomers: ids.length,
        activeSubscriptions: targetImpact.activeSubscriptions,
        enterpriseCustomers: targetImpact.enterpriseCustomers,
        mrrAtRisk: targetImpact.mrrAtRisk,
        openTickets: targetImpact.openTickets,
        rollbackComplete: true,
        chaosOnly: plan.filters.chaos_only,
      });
      const conf = confidence({ dependencyCoverage: plan.filters.chaos_only ? 82 : 96, rollbackCoverage: 100, externalEffects: plan.filters.chaos_only });
      return {
        simulation_id: simulationId,
        action_plan: plan,
        state_fingerprint: stateFingerprint,
        expires_at: expiresAt.toISOString(),
        risk,
        confidence: conf,
        policy: { approval_allowed: risk.level !== "HIGH", reason: risk.level === "HIGH" ? "Protected revenue or Enterprise state is inside the destructive envelope." : "Impact remains inside the current approval policy." },
        direct_impact: { customers: ids.length },
        business_impact: { mrr_at_risk: targetImpact.mrrAtRisk, active_subscriptions: targetImpact.activeSubscriptions, enterprise_customers: targetImpact.enterpriseCustomers },
        related_state: { open_tickets: targetImpact.openTickets, notes: targetImpact.notes },
        before,
        after,
        diff: {
          customers: { before: before.customers, after: after.customers, delta: after.customers - before.customers },
          active_subscriptions: { before: before.active_subscriptions, after: after.active_subscriptions, delta: after.active_subscriptions - before.active_subscriptions },
          mrr: { before: before.mrr, after: after.mrr, delta: after.mrr - before.mrr },
        },
        impacted_customers: targets.map((r) => ({ id: r.id, name: r.name, email: r.email, segment: r.segment, status: r.status, last_active_at: r.last_active_at })),
        rollback_plan: { customer_rows: ids.length, subscription_rows: targetImpact.activeSubscriptions, ticket_rows: targetImpact.openTickets, note_rows: targetImpact.notes, snapshot_strategy: "row journal + ordered restore" },
        predicted_account_summary: predictedSummary,
        known_unknowns: ["Effects outside the observed dependency graph are not guaranteed.", "External integrations are not replayed inside the database transaction.", ...(plan.filters.chaos_only ? ["Failure test intentionally omits one trigger side effect from the simulation model."] : [])],
        recommendation: risk.level === "HIGH" ? "Modify the action before execution." : "Impact is inside policy; execution can proceed through the gated path.",
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });

  await withClient(async (client) => {
    await client.query(
      `INSERT INTO simulation_runs(id,session_id,action_plan,target_ids,state_fingerprint,report,status,expires_at)
       VALUES($1,$2,$3::jsonb,$4::uuid[],$5,$6::jsonb,'simulated',$7)`,
      [simulationId, sessionId, json(plan), report.impacted_customers.map((c) => c.id), report.state_fingerprint, json(report), expiresAt],
    );
    await audit(client, sessionId, "SIMULATION_COMPLETED", { risk: report.risk.level, targets: report.direct_impact.customers, fingerprint: report.state_fingerprint }, simulationId);
  });
  return report;
}

async function snapshotRows(client: PoolClient, sessionId: string, executionId: string, ids: string[]) {
  const sets: Array<{ table: string; order: number; rows: Record<string, unknown>[] }> = [];
  const customers = ids.length ? (await client.query(`SELECT * FROM customers WHERE session_id=$1 AND id=ANY($2::uuid[]) ORDER BY id`, [sessionId, ids])).rows : [];
  const subscriptions = ids.length ? (await client.query(`SELECT * FROM subscriptions WHERE session_id=$1 AND customer_id=ANY($2::uuid[]) ORDER BY id`, [sessionId, ids])).rows : [];
  const tickets = ids.length ? (await client.query(`SELECT * FROM support_tickets WHERE session_id=$1 AND customer_id=ANY($2::uuid[]) ORDER BY id`, [sessionId, ids])).rows : [];
  const notes = ids.length ? (await client.query(`SELECT * FROM customer_notes WHERE session_id=$1 AND customer_id=ANY($2::uuid[]) ORDER BY id`, [sessionId, ids])).rows : [];
  const summary = (await client.query(`SELECT * FROM account_summary WHERE session_id=$1`, [sessionId])).rows;
  sets.push({ table: "customers", order: 1, rows: customers }, { table: "subscriptions", order: 2, rows: subscriptions }, { table: "support_tickets", order: 3, rows: tickets }, { table: "customer_notes", order: 4, rows: notes }, { table: "account_summary", order: 5, rows: summary });
  for (const set of sets) {
    for (const row of set.rows) {
      await client.query(
        `INSERT INTO rollback_snapshots(id,execution_id,session_id,table_name,row_id,serialized_row,restore_order) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)`,
        [randomUUID(), executionId, sessionId, set.table, (row.id as string | undefined) ?? null, json(row), set.order],
      );
    }
  }
  return { customers: customers.length, subscriptions: subscriptions.length, tickets: tickets.length, notes: notes.length, summary: summary.length };
}

function sameNumber(a: unknown, b: unknown) { return Math.abs(num(a) - num(b)) < 0.0001; }

export async function executeSimulation(sessionId: string, simulationId: string) {
  await ensureSchema();
  const pool = getPool();
  const simResult = await pool.query(`SELECT * FROM simulation_runs WHERE id=$1 AND session_id=$2`, [simulationId, sessionId]);
  const sim = simResult.rows[0];
  if (!sim) throw new Error("Simulation not found");
  if (sim.status !== "simulated") throw new Error(`Simulation is ${sim.status}; a fresh simulation is required.`);
  if (new Date(sim.expires_at).getTime() < Date.now()) throw new Error("Simulation expired. Re-simulation required.");
  const report = sim.report as Record<string, any>;
  if (!report.policy?.approval_allowed) throw new Error("Policy blocked approval. Apply a safer tweak and re-simulate.");
  const plan = actionPlanSchema.parse(sim.action_plan);
  const executionId = randomUUID();
  await pool.query(`INSERT INTO execution_runs(id,session_id,simulation_id,status) VALUES($1,$2,$3,'pending')`, [executionId, sessionId, simulationId]);

  const outcome = await withClient(async (client) => {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    try {
      const targets = await targetRows(client, sessionId, plan, true);
      const ids = targets.map((r) => String(r.id));
      const vector = await targetVector(client, sessionId, ids);
      const currentFingerprint = fingerprint({ plan: normalizePlan(plan), vector });
      const expectedIds = [...(sim.target_ids as string[])].sort();
      const currentIds = [...ids].sort();
      if (currentFingerprint !== sim.state_fingerprint || json(expectedIds) !== json(currentIds)) {
        await client.query("ROLLBACK");
        return { status: "stale" as const, divergence: { type: "STATE_CHANGED", expected_fingerprint: sim.state_fingerprint, observed_fingerprint: currentFingerprint } };
      }

      const snapshot = await snapshotRows(client, sessionId, executionId, ids);
      const summaryBefore = await accountSummary(client, sessionId);
      if (ids.length) await client.query(`DELETE FROM customers WHERE session_id=$1 AND id=ANY($2::uuid[])`, [sessionId, ids]);
      const observed = await worldState(client, sessionId);
      const summaryAfter = await accountSummary(client, sessionId);
      const expected = report.after;
      const predictedSummary = report.predicted_account_summary;
      const deviations: string[] = [];
      if (observed.customers !== num(expected.customers)) deviations.push(`customers expected ${expected.customers}, observed ${observed.customers}`);
      if (observed.active_subscriptions !== num(expected.active_subscriptions)) deviations.push(`active subscriptions expected ${expected.active_subscriptions}, observed ${observed.active_subscriptions}`);
      if (!sameNumber(observed.mrr, expected.mrr)) deviations.push(`MRR expected ${expected.mrr}, observed ${observed.mrr}`);
      if (predictedSummary && summaryAfter) {
        if (summaryAfter.enterprise_customers !== num(predictedSummary.enterprise_customers)) deviations.push(`account_summary.enterprise_customers expected ${predictedSummary.enterprise_customers}, observed ${summaryAfter.enterprise_customers}`);
        if (!sameNumber(summaryAfter.mrr, predictedSummary.mrr)) deviations.push(`account_summary.mrr expected ${predictedSummary.mrr}, observed ${summaryAfter.mrr}`);
        if (summaryAfter.active_customers !== num(predictedSummary.active_customers)) deviations.push(`account_summary.active_customers expected ${predictedSummary.active_customers}, observed ${summaryAfter.active_customers}`);
      }
      if (deviations.length) {
        await client.query("ROLLBACK");
        return { status: "blocked" as const, divergence: { type: "SIMULATION_DIVERGENCE", deviations, predicted: { world: expected, account_summary: predictedSummary }, observed: { world: observed, account_summary: summaryAfter }, safety_response: "Transaction rolled back automatically", final_persistent_state: "UNCHANGED" } };
      }
      await client.query("COMMIT");
      return { status: "completed" as const, snapshot, observed, summaryBefore, summaryAfter };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });

  if (outcome.status === "stale") {
    await pool.query(`UPDATE execution_runs SET status='blocked_stale',divergence=$2::jsonb,completed_at=now() WHERE id=$1`, [executionId, json(outcome.divergence)]);
    await pool.query(`UPDATE simulation_runs SET status='stale' WHERE id=$1`, [simulationId]);
    await withClient((client) => audit(client, sessionId, "EXECUTION_BLOCKED_STALE_STATE", outcome.divergence, simulationId, executionId));
    return { execution_id: executionId, status: "BLOCKED", reason: "State changed since simulation. Re-simulation required.", divergence: outcome.divergence, state: await getState(sessionId) };
  }
  if (outcome.status === "blocked") {
    await pool.query(`UPDATE execution_runs SET status='blocked_divergence',divergence=$2::jsonb,completed_at=now() WHERE id=$1`, [executionId, json(outcome.divergence)]);
    await withClient((client) => audit(client, sessionId, "EXECUTION_BLOCKED_DIVERGENCE", outcome.divergence, simulationId, executionId));
    return { execution_id: executionId, status: "BLOCKED", reason: "Simulation divergence detected. Transaction rolled back automatically.", divergence: outcome.divergence, state: await getState(sessionId) };
  }

  await pool.query(`UPDATE execution_runs SET status='completed',completed_at=now() WHERE id=$1`, [executionId]);
  await pool.query(`UPDATE simulation_runs SET status='executed' WHERE id=$1`, [simulationId]);
  await withClient((client) => audit(client, sessionId, "EXECUTION_COMMITTED", { snapshot: outcome.snapshot, observed: outcome.observed }, simulationId, executionId));
  return { execution_id: executionId, status: "COMPLETED", rollback_available: true, snapshot: outcome.snapshot, state: await getState(sessionId) };
}

async function restoreRow(client: PoolClient, table: string, row: Record<string, any>) {
  switch (table) {
    case "customers":
      await client.query(`INSERT INTO customers(id,session_id,name,email,status,last_active_at,created_at,updated_at,segment) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(id) DO NOTHING`, [row.id,row.session_id,row.name,row.email,row.status,row.last_active_at,row.created_at,row.updated_at,row.segment]);
      break;
    case "subscriptions":
      await client.query(`INSERT INTO subscriptions(id,session_id,customer_id,plan,status,renewal_date,mrr) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO NOTHING`, [row.id,row.session_id,row.customer_id,row.plan,row.status,row.renewal_date,row.mrr]);
      break;
    case "support_tickets":
      await client.query(`INSERT INTO support_tickets(id,session_id,customer_id,status,priority,subject) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO NOTHING`, [row.id,row.session_id,row.customer_id,row.status,row.priority,row.subject]);
      break;
    case "customer_notes":
      await client.query(`INSERT INTO customer_notes(id,session_id,customer_id,content) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING`, [row.id,row.session_id,row.customer_id,row.content]);
      break;
    case "account_summary":
      await client.query(`INSERT INTO account_summary(session_id,active_customers,enterprise_customers,mrr,updated_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(session_id) DO UPDATE SET active_customers=EXCLUDED.active_customers,enterprise_customers=EXCLUDED.enterprise_customers,mrr=EXCLUDED.mrr,updated_at=EXCLUDED.updated_at`, [row.session_id,row.active_customers,row.enterprise_customers,row.mrr,row.updated_at]);
      break;
    default:
      throw new Error("Unknown rollback table");
  }
}

export async function rollbackExecution(sessionId: string, executionId: string) {
  await ensureSchema();
  const pool = getPool();
  const exec = (await pool.query(`SELECT * FROM execution_runs WHERE id=$1 AND session_id=$2`, [executionId, sessionId])).rows[0];
  if (!exec) throw new Error("Execution not found");
  if (exec.status !== "completed") throw new Error(`Execution is ${exec.status}; rollback is not available.`);
  const snapshots = (await pool.query(`SELECT table_name,serialized_row,restore_order FROM rollback_snapshots WHERE execution_id=$1 AND session_id=$2 ORDER BY restore_order,created_at`, [executionId, sessionId])).rows;
  await withClient(async (client) => {
    await client.query("BEGIN");
    try {
      for (const s of snapshots) await restoreRow(client, s.table_name, s.serialized_row);
      await client.query(`UPDATE execution_runs SET status='rolled_back',completed_at=now() WHERE id=$1`, [executionId]);
      await client.query(`UPDATE simulation_runs SET status='rolled_back' WHERE id=$1`, [exec.simulation_id]);
      await audit(client, sessionId, "ROLLBACK_COMPLETED", { restored_rows: snapshots.length }, exec.simulation_id, executionId);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
  return { status: "ROLLED_BACK", restored_rows: snapshots.length, state: await getState(sessionId) };
}

export async function rejectSimulation(sessionId: string, simulationId: string) {
  await ensureSchema();
  const result = await getPool().query(`UPDATE simulation_runs SET status='rejected' WHERE id=$1 AND session_id=$2 AND status='simulated' RETURNING id`, [simulationId, sessionId]);
  if (!result.rowCount) throw new Error("Simulation cannot be rejected in its current state.");
  await withClient((client) => audit(client, sessionId, "SIMULATION_REJECTED", {}, simulationId));
  return { status: "REJECTED", state: await getState(sessionId) };
}

export async function getState(sessionId: string) {
  await ensureSchema();
  const pool = getPool();
  const [customers, summary, auditEvents, simulations, executions] = await Promise.all([
    pool.query(`SELECT c.id,c.name,c.email,c.status,c.segment,c.last_active_at,
      COALESCE((SELECT sum(mrr) FROM subscriptions s WHERE s.customer_id=c.id AND s.status='active'),0)::float8 AS active_mrr,
      EXISTS(SELECT 1 FROM subscriptions s WHERE s.customer_id=c.id AND s.status='active') AS has_active_subscription
      FROM customers c WHERE c.session_id=$1 ORDER BY c.name`, [sessionId]),
    pool.query(`SELECT active_customers,enterprise_customers,mrr::float8 AS mrr,updated_at FROM account_summary WHERE session_id=$1`, [sessionId]),
    pool.query(`SELECT event_type,simulation_id,execution_id,detail,created_at FROM audit_events WHERE session_id=$1 ORDER BY created_at DESC LIMIT 20`, [sessionId]),
    pool.query(`SELECT id,status,report,created_at,expires_at FROM simulation_runs WHERE session_id=$1 ORDER BY created_at DESC LIMIT 5`, [sessionId]),
    pool.query(`SELECT id,simulation_id,status,divergence,created_at,completed_at FROM execution_runs WHERE session_id=$1 ORDER BY created_at DESC LIMIT 5`, [sessionId]),
  ]);
  return { customers: customers.rows, account_summary: summary.rows[0] ?? null, audit: auditEvents.rows, simulations: simulations.rows, executions: executions.rows };
}
