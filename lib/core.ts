import { createHash } from "node:crypto";
import { z } from "zod";

export const actionPlanSchema = z.object({
  action: z.literal("delete_customers"),
  filters: z.object({
    inactive_days: z.number().int().min(30).max(3650),
    exclude_active_subscriptions: z.boolean().default(false),
    exclude_enterprise: z.boolean().default(false),
    limit: z.number().int().min(1).max(100).nullable().default(null),
    chaos_only: z.boolean().default(false),
  }),
});

export type ActionPlan = z.infer<typeof actionPlanSchema>;

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";

export function normalizePlan(plan: ActionPlan): ActionPlan {
  return actionPlanSchema.parse({
    action: plan.action,
    filters: {
      inactive_days: plan.filters.inactive_days,
      exclude_active_subscriptions: plan.filters.exclude_active_subscriptions,
      exclude_enterprise: plan.filters.exclude_enterprise,
      limit: plan.filters.limit ?? null,
      chaos_only: plan.filters.chaos_only,
    },
  });
}

export function fingerprint(input: unknown): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

export function deriveRisk(input: {
  affectedCustomers: number;
  activeSubscriptions: number;
  enterpriseCustomers: number;
  mrrAtRisk: number;
  openTickets: number;
  rollbackComplete: boolean;
  chaosOnly?: boolean;
}): { level: RiskLevel; reasons: string[] } {
  const reasons: string[] = [];
  if (input.activeSubscriptions > 0) reasons.push("Active subscriptions would be deleted with their customers.");
  if (input.enterpriseCustomers > 0) reasons.push("Protected Enterprise customers are inside the target set.");
  if (input.mrrAtRisk > 0) reasons.push(`$${input.mrrAtRisk.toLocaleString()} MRR is attached to targeted customers.`);
  if (input.openTickets > 0) reasons.push(`${input.openTickets} open support ticket(s) are attached to targeted customers.`);
  if (input.affectedCustomers >= 25) reasons.push("Large destructive mutation budget.");
  if (!input.rollbackComplete) reasons.push("Rollback coverage is incomplete.");
  if (input.chaosOnly) reasons.push("Failure-test target has an intentionally incomplete dependency model.");

  const high = input.activeSubscriptions > 0 || input.enterpriseCustomers > 0 || input.mrrAtRisk > 0 || !input.rollbackComplete;
  if (high) return { level: "HIGH", reasons };
  if (input.affectedCustomers >= 10 || input.openTickets > 0 || input.chaosOnly) return { level: "MEDIUM", reasons };
  return { level: "LOW", reasons: reasons.length ? reasons : ["No protected relationships; rollback coverage is complete."] };
}

export function confidence(input: { dependencyCoverage: number; rollbackCoverage: number; externalEffects: boolean }): number {
  const externalPenalty = input.externalEffects ? 8 : 0;
  return Math.max(0, Math.min(100, Math.round(input.dependencyCoverage * 0.55 + input.rollbackCoverage * 0.45 - externalPenalty)));
}
