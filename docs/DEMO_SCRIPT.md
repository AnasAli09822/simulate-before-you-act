# Foresee — 90-second walkthrough

## 0–8s — Establish the safety layer

“This is Foresee. It sits between an AI agent and a high-stakes write, so the system can see the consequences before the write gets authority.”

Point to: `Intent → Simulate → Review → Execute → Verify`.

## 8–20s — Submit the destructive intent

Use the default action:

> Delete customers inactive for more than 12 months.

“Foresee converts this to a constrained action DSL. The browser never sends arbitrary SQL.”

Click **Simulate action**.

## 20–36s — Show the real simulation

“This is not an LLM prediction. Foresee resolves the exact PostgreSQL rows, performs the DELETE inside a real transaction, measures the candidate state, and rolls it back.”

Point out:

- Risk: **HIGH**
- the inactive **Atlas Enterprise** account,
- its active Enterprise subscription,
- **$2,400 MRR at risk**,
- the real impacted rows,
- the rollback plan and state fingerprint.

“Approval is blocked because simulation changed what we know about this decision.”

## 36–50s — Let simulation change the action

Click **Tweak: exclude active subscriptions**.

“The same intent is now re-simulated with one bounded filter change.”

Point out:

- protected active subscriptions: **1 → 0** compared with the unsafe proposal,
- MRR at risk: **$2,400 → $0**,
- Risk: **HIGH → LOW**.

## 50–64s — Approve only the exact simulated plan

Click **Approve exact plan**.

“Execution reloads and locks the target rows, recomputes the fingerprint, journals the rollback data, performs the mutation, and verifies observed reality before commit.”

Show the committed result, then click **Rollback execution**.

“The rollback is real; journaled rows are restored in dependency order.”

## 64–86s — Make the simulator wrong on purpose

Click **Run deterministic failure test**, then approve it.

“This case contains a hidden PostgreSQL trigger that the simulation dependency model intentionally misses.”

Point to **EXECUTION BLOCKED**.

“The runtime verifier sees an unexpected `account_summary` change before commit. Foresee rolls the transaction back automatically. Persistent business state stays unchanged.”

## 86–90s — Close

“Simulation predicts. Policy decides. Runtime verification confirms. Rollback protects against prediction error.”
