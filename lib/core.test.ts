import { describe, expect, it } from "vitest";
import { confidence, deriveRisk, fingerprint, normalizePlan } from "./core";

describe("Foresee safety core", () => {
  it("marks protected revenue as high risk", () => {
    const result = deriveRisk({ affectedCustomers: 4, activeSubscriptions: 1, enterpriseCustomers: 1, mrrAtRisk: 2400, openTickets: 1, rollbackComplete: true });
    expect(result.level).toBe("HIGH");
    expect(result.reasons.join(" ")).toContain("MRR");
  });

  it("drops to low risk when protected relationships are excluded", () => {
    const result = deriveRisk({ affectedCustomers: 3, activeSubscriptions: 0, enterpriseCustomers: 0, mrrAtRisk: 0, openTickets: 0, rollbackComplete: true });
    expect(result.level).toBe("LOW");
  });

  it("normalizes plans deterministically for fingerprinting", () => {
    const plan = normalizePlan({ action: "delete_customers", filters: { inactive_days: 365, exclude_active_subscriptions: true, exclude_enterprise: false, limit: null, chaos_only: false } });
    expect(fingerprint({ plan, rows: ["a", "b"] })).toBe(fingerprint({ plan, rows: ["a", "b"] }));
  });

  it("lowers confidence when deterministic coverage is incomplete", () => {
    expect(confidence({ dependencyCoverage: 82, rollbackCoverage: 100, externalEffects: true })).toBeLessThan(confidence({ dependencyCoverage: 96, rollbackCoverage: 100, externalEffects: false }));
  });
});
