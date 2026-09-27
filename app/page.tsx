"use client";

import { useEffect, useMemo, useState } from "react";

type ActionPlan = {
  action: "delete_customers";
  filters: {
    inactive_days: number;
    exclude_active_subscriptions: boolean;
    exclude_enterprise: boolean;
    limit: number | null;
    chaos_only: boolean;
  };
};

type Report = {
  simulation_id: string;
  action_plan: ActionPlan;
  risk: { level: "LOW" | "MEDIUM" | "HIGH"; reasons: string[] };
  confidence: number;
  policy: { approval_allowed: boolean; reason: string };
  direct_impact: { customers: number };
  business_impact: { mrr_at_risk: number; active_subscriptions: number; enterprise_customers: number };
  related_state: { open_tickets: number; notes: number };
  diff: Record<string, { before: number; after: number; delta: number }>;
  impacted_customers: Array<{ id: string; name: string; email: string; segment: string; status: string; last_active_at: string }>;
  rollback_plan: { customer_rows: number; subscription_rows: number; ticket_rows: number; note_rows: number; snapshot_strategy: string };
  known_unknowns: string[];
  recommendation: string;
  state_fingerprint: string;
};

type DemoState = {
  customers: Array<{ id: string; name: string; email: string; status: string; segment: string; last_active_at: string; active_mrr: number; has_active_subscription: boolean }>;
  account_summary: { active_customers: number; enterprise_customers: number; mrr: number } | null;
  audit: Array<{ event_type: string; detail: Record<string, unknown>; created_at: string }>;
  simulations: Array<{ id: string; status: string; report: Report }>;
  executions: Array<{ id: string; status: string; divergence: Record<string, unknown> | null }>;
};

type ExecuteResult = {
  execution_id: string;
  status: string;
  reason?: string;
  divergence?: { deviations?: string[]; safety_response?: string; final_persistent_state?: string };
  rollback_available?: boolean;
  state: DemoState;
};

const baselinePlan: ActionPlan = {
  action: "delete_customers",
  filters: { inactive_days: 365, exclude_active_subscriptions: false, exclude_enterprise: false, limit: null, chaos_only: false },
};

function money(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value || 0);
}

export default function Home() {
  const [sessionId, setSessionId] = useState("");
  const [state, setState] = useState<DemoState | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [execution, setExecution] = useState<ExecuteResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function call<T>(payload: Record<string, unknown>): Promise<T> {
    const response = await fetch("/api/foresee", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const data = await response.json();
    if (!data.ok) throw new Error(data.error || "Request failed");
    return data.result as T;
  }

  useEffect(() => {
    const key = "foresee-demo-session";
    let id = localStorage.getItem(key);
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
      id = crypto.randomUUID();
      localStorage.setItem(key, id);
    }
    setSessionId(id);
    setBusy(true);
    call<DemoState>({ op: "init", session_id: id })
      .then((s) => { setState(s); const latest = s.simulations?.[0]?.report; if (latest) setReport(latest); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  }, []);

  const pipeline = useMemo(() => {
    if (execution?.status === "BLOCKED") return ["Intent", "Simulate", "Review", "Execute", "Rollback"];
    if (execution?.status === "COMPLETED") return ["Intent", "Simulate", "Review", "Execute", "Verify"];
    if (report) return ["Intent", "Simulate", "Review"];
    return ["Intent"];
  }, [report, execution]);

  async function runSimulation(plan: ActionPlan = baselinePlan) {
    if (!sessionId) return;
    setBusy(true); setError(""); setExecution(null);
    try {
      const next = await call<Report>({ op: "simulate", session_id: sessionId, plan });
      setReport(next);
      const s = await call<DemoState>({ op: "state", session_id: sessionId });
      setState(s);
    } catch (e) { setError(e instanceof Error ? e.message : "Simulation failed"); }
    finally { setBusy(false); }
  }

  async function execute() {
    if (!sessionId || !report) return;
    setBusy(true); setError("");
    try {
      const result = await call<ExecuteResult>({ op: "execute", session_id: sessionId, simulation_id: report.simulation_id });
      setExecution(result); setState(result.state);
    } catch (e) { setError(e instanceof Error ? e.message : "Execution failed"); }
    finally { setBusy(false); }
  }

  async function reject() {
    if (!sessionId || !report) return;
    setBusy(true); setError("");
    try {
      const result = await call<{ state: DemoState }>({ op: "reject", session_id: sessionId, simulation_id: report.simulation_id });
      setState(result.state); setReport(null); setExecution(null);
    } catch (e) { setError(e instanceof Error ? e.message : "Reject failed"); }
    finally { setBusy(false); }
  }

  async function rollback() {
    if (!sessionId || !execution?.execution_id) return;
    setBusy(true); setError("");
    try {
      const result = await call<{ status: string; restored_rows: number; state: DemoState }>({ op: "rollback", session_id: sessionId, execution_id: execution.execution_id });
      setState(result.state); setExecution({ ...execution, status: result.status, state: result.state });
    } catch (e) { setError(e instanceof Error ? e.message : "Rollback failed"); }
    finally { setBusy(false); }
  }

  async function reset() {
    if (!sessionId) return;
    setBusy(true); setError("");
    try {
      const s = await call<DemoState>({ op: "reset", session_id: sessionId });
      setState(s); setReport(null); setExecution(null);
    } catch (e) { setError(e instanceof Error ? e.message : "Reset failed"); }
    finally { setBusy(false); }
  }

  const saferPlan: ActionPlan = report ? { ...report.action_plan, filters: { ...report.action_plan.filters, exclude_active_subscriptions: true, chaos_only: false } } : baselinePlan;
  const enterpriseSafePlan: ActionPlan = report ? { ...report.action_plan, filters: { ...report.action_plan.filters, exclude_enterprise: true, chaos_only: false } } : baselinePlan;
  const failurePlan: ActionPlan = { ...baselinePlan, filters: { ...baselinePlan.filters, chaos_only: true } };

  return (
    <main className="shell">
      <header className="topbar">
        <div><div className="brand"><span className="brandMark">F</span> Foresee</div><p>See the consequences before your agent acts.</p></div>
        <div className="topActions"><span className="dbBadge"><i /> PostgreSQL world model</span><button className="ghost" onClick={reset} disabled={busy}>Reset demo</button></div>
      </header>

      <section className="actionCard">
        <div><span className="eyebrow">Requested action</span><h1>{report?.action_plan.filters.chaos_only ? "Delete the hidden-dependency test customer" : "Delete customers inactive for more than 12 months"}</h1><div className="dsl">{report ? JSON.stringify(report.action_plan) : JSON.stringify(baselinePlan)}</div></div>
        <div className="actionMeta"><span>Target</span><strong>PostgreSQL / customers</strong><span>Mode</span><strong>Transactional dry-run</strong></div>
      </section>

      <nav className="pipeline" aria-label="Safety pipeline">
        {["Intent", "Simulate", "Review", "Execute", "Verify"].map((step, i) => <div key={step} className={pipeline.includes(step) ? "step active" : "step"}><span>{i + 1}</span>{step}</div>)}
      </nav>

      {error && <div className="errorBanner"><strong>Request failed</strong><span>{error}</span></div>}

      {!report && (
        <section className="emptyState panel">
          <div><span className="eyebrow">Start here</span><h2>Run the destructive action without changing persistent state.</h2><p>Foresee executes the candidate DELETE inside a real database transaction, measures the state transition, then rolls the transaction back before you decide.</p></div>
          <div className="startActions"><button className="primary" onClick={() => runSimulation()} disabled={busy}>{busy ? "Preparing…" : "Simulate action"}</button><button className="secondary" onClick={() => runSimulation(failurePlan)} disabled={busy}>Run failure test</button></div>
        </section>
      )}

      {report && (
        <>
          <section className="metricsGrid">
            <article className="metric"><span>Risk</span><strong className={`risk ${report.risk.level.toLowerCase()}`}>{report.risk.level}</strong><small>{report.risk.reasons[0]}</small></article>
            <article className="metric"><span>Confidence</span><strong>{report.confidence}%</strong><small>Coverage-based, not model guesswork</small></article>
            <article className="metric"><span>Customers affected</span><strong>{report.direct_impact.customers}</strong><small>Exact target rows from PostgreSQL</small></article>
            <article className="metric"><span>MRR at risk</span><strong>{money(report.business_impact.mrr_at_risk)}</strong><small>{report.business_impact.active_subscriptions} active subscription(s)</small></article>
          </section>

          <section className="panel">
            <div className="sectionHead"><div><span className="eyebrow">Before → after</span><h2>Measured state transition</h2></div><span className="rollbackProof">Simulation transaction rolled back ✓</span></div>
            <div className="diffGrid">
              {Object.entries(report.diff).map(([name, d]) => <div className="diff" key={name}><span>{name.replaceAll("_", " ")}</span><div><b>{name === "mrr" ? money(d.before) : d.before}</b><em>→</em><b>{name === "mrr" ? money(d.after) : d.after}</b><strong className={d.delta < 0 ? "negative" : "neutral"}>{name === "mrr" ? money(d.delta) : d.delta}</strong></div></div>)}
            </div>
          </section>

          <div className="twoCol">
            <section className="panel">
              <div className="sectionHead"><div><span className="eyebrow">Impacted records</span><h2>Real rows</h2></div><span className="count">{report.impacted_customers.length}</span></div>
              <div className="tableWrap"><table><thead><tr><th>Customer</th><th>Segment</th><th>State</th></tr></thead><tbody>{report.impacted_customers.map((c) => <tr key={c.id}><td><strong>{c.name}</strong><small>{c.email}</small></td><td>{c.segment}</td><td><span className="deleteTag">DELETE</span></td></tr>)}</tbody></table></div>
            </section>
            <section className="panel">
              <span className="eyebrow">Rollback plan</span><h2>Reversible by construction</h2>
              <div className="rollbackList"><div><span>Customer rows</span><b>{report.rollback_plan.customer_rows}</b></div><div><span>Subscriptions</span><b>{report.rollback_plan.subscription_rows}</b></div><div><span>Tickets</span><b>{report.rollback_plan.ticket_rows}</b></div><div><span>Notes</span><b>{report.rollback_plan.note_rows}</b></div></div>
              <p className="muted">{report.rollback_plan.snapshot_strategy}. Snapshot journal is persisted only if execution commits.</p>
              <div className="fingerprint"><span>State fingerprint</span><code>{report.state_fingerprint.slice(0, 18)}…</code></div>
            </section>
          </div>

          {execution?.status === "BLOCKED" && <section className="blocked panel"><span className="eyebrow">Runtime safety net</span><h2>EXECUTION BLOCKED</h2><p>{execution.reason}</p>{execution.divergence?.deviations?.map((d) => <code key={d}>{d}</code>)}<div className="safeState">Safety response: {execution.divergence?.safety_response || "blocked"} · Persistent state: {execution.divergence?.final_persistent_state || "unchanged"}</div></section>}
          {execution?.status === "COMPLETED" && <section className="success panel"><span className="eyebrow">Runtime verification</span><h2>Execution committed inside the approved impact envelope.</h2><p>The exact simulated target set passed fingerprint validation and post-action invariants.</p><button className="secondary" onClick={rollback} disabled={busy}>Rollback execution</button></section>}
          {execution?.status === "ROLLED_BACK" && <section className="success panel"><h2>Rollback completed.</h2><p>Journaled customer and dependency rows were restored in dependency order.</p></section>}

          <section className="decisionBar">
            <div><span className="eyebrow">Human decision</span><strong>{report.recommendation}</strong><small>{report.policy.reason}</small></div>
            <div className="decisionActions"><button className="ghost danger" onClick={reject} disabled={busy || !!execution}>Reject</button><button className="secondary" onClick={() => runSimulation(saferPlan)} disabled={busy || report.action_plan.filters.chaos_only}>Tweak: exclude active subscriptions</button><button className="secondary" onClick={() => runSimulation(enterpriseSafePlan)} disabled={busy || report.action_plan.filters.chaos_only}>Exclude Enterprise</button><button className="primary" onClick={execute} disabled={busy || !report.policy.approval_allowed || !!execution}>{report.policy.approval_allowed ? "Approve exact plan" : "Approval blocked"}</button></div>
          </section>

          <section className="panel unknowns"><div><span className="eyebrow">Known unknowns</span><h2>Simulation is not omniscient.</h2></div><ul>{report.known_unknowns.map((u) => <li key={u}>{u}</li>)}</ul><button className="linkButton" onClick={() => runSimulation(failurePlan)} disabled={busy}>Run deterministic failure test →</button></section>
        </>
      )}

      <section className="twoCol bottom">
        <section className="panel"><span className="eyebrow">Current database</span><h2>Session-isolated state</h2><div className="stateStats"><div><b>{state?.customers.length ?? "—"}</b><span>customers</span></div><div><b>{state?.account_summary?.enterprise_customers ?? "—"}</b><span>enterprise</span></div><div><b>{money(state?.account_summary?.mrr ?? 0)}</b><span>protected MRR</span></div></div></section>
        <section className="panel"><span className="eyebrow">Audit timeline</span><h2>Every decision is recorded.</h2><div className="timeline">{state?.audit.slice(0, 6).map((a, i) => <div key={`${a.created_at}-${i}`}><i /><span><strong>{a.event_type.replaceAll("_", " ")}</strong><small>{new Date(a.created_at).toLocaleTimeString()}</small></span></div>)}</div></section>
      </section>

      <footer><span>Foresee · Simulate → Policy → Execute → Verify → Rollback</span><span>Session {sessionId ? `${sessionId.slice(0, 8)}…` : "initializing"}</span></footer>
    </main>
  );
}
