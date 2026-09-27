import { expect, test } from "@playwright/test";

test("reviewer path changes an unsafe decision, executes the safer plan, and rolls it back", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Run the destructive action/i })).toBeVisible();

  await page.getByRole("button", { name: "Simulate action" }).click();
  await expect(page.getByText("HIGH", { exact: true })).toBeVisible();
  await expect(page.getByText("$2,400", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Approval blocked" })).toBeDisabled();
  await expect(page.getByText("Atlas Enterprise", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: /Tweak: exclude active subscriptions/i }).click();
  await expect(page.getByText("LOW", { exact: true })).toBeVisible();
  await expect(page.getByText("$0", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve exact plan" })).toBeEnabled();

  await page.getByRole("button", { name: "Approve exact plan" }).click();
  await expect(page.getByRole("heading", { name: /Execution committed inside the approved impact envelope/i })).toBeVisible();
  await expect(page.getByText("3", { exact: true }).first()).toBeVisible();

  await page.getByRole("button", { name: "Rollback execution" }).click();
  await expect(page.getByRole("heading", { name: "Rollback completed." })).toBeVisible();
  await expect(page.getByText("6", { exact: true }).first()).toBeVisible();
});

test("runtime verifier catches the intentionally hidden side effect before commit", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Run the destructive action/i })).toBeVisible();

  await page.getByRole("button", { name: "Run failure test" }).click();
  await expect(page.getByText("MEDIUM", { exact: true })).toBeVisible();
  await expect(page.getByText("Chaos Ghost", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve exact plan" })).toBeEnabled();

  await page.getByRole("button", { name: "Approve exact plan" }).click();
  await expect(page.getByRole("heading", { name: "EXECUTION BLOCKED" })).toBeVisible();
  await expect(page.getByText(/account_summary\.enterprise_customers expected 1, observed 0/i)).toBeVisible();
  await expect(page.getByText(/Persistent state: UNCHANGED/i)).toBeVisible();

  await expect(page.getByText("6", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("$3,300", { exact: true }).first()).toBeVisible();
});
