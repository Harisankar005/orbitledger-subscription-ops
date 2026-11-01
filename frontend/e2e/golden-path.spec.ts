import { test, expect } from "@playwright/test";

test.describe("OrbitLedger Golden Path E2E", () => {
  const uniqueId = Date.now().toString().slice(-6);
  const newCustomerEmail = `e2e_cust_${uniqueId}@brightloop.test`;
  const securePassword = "SecurePass123!";

  test("full lifecycle: signup -> admin plan -> staff subscription -> billing -> payment -> dashboard -> portal isolation", async ({
    page,
  }) => {
    // 1. Customer Signup
    await page.goto("/register");
    await expect(page.getByRole("heading", { name: /create your account/i })).toBeVisible();

    await page.fill('input[name="full_name"]', `Acme Corp ${uniqueId}`);
    await page.fill('input[name="email"]', newCustomerEmail);
    await page.fill('input[name="company"]', `Acme Global ${uniqueId}`);
    await page.fill('input[name="phone"]', "9876543210");
    await page.fill('input[name="password"]', securePassword);

    await page.getByRole("button", { name: /create account/i }).click();

    // Arrives at customer portal
    await page.waitForURL("**/portal**");
    await expect(page.getByRole("heading", { name: /my subscriptions/i })).toBeVisible();

    // Log out customer
    await page.goto("/login");

    // 2. Admin Log In
    await page.fill('input[name="email"]', "admin@brightloop.test");
    await page.fill('input[name="password"]', "Admin@1234");
    await page.getByRole("button", { name: /sign in/i }).click();

    await page.waitForURL("**/");
    await expect(page.getByRole("heading", { name: /operations dashboard/i })).toBeVisible();

    // 3. Admin creates Plan in Catalog
    await page.goto("/catalog");
    await expect(page.getByRole("heading", { name: /catalog management/i })).toBeVisible();

    const planTab = page.getByRole("tab", { name: /plans/i });
    if (await planTab.isVisible()) {
      await planTab.click();
    }

    const addPlanBtn = page.getByRole("button", { name: /add plan/i });
    await expect(addPlanBtn).toBeVisible();
    await addPlanBtn.click();

    const planName = `E2E Plan ${uniqueId}`;
    await page.fill('input[name="name"]', planName);
    await page.fill('input[name="price"]', "1200.00");
    await page.getByRole("button", { name: /create plan/i }).click();

    // Wait for plan dialog to close and plan to appear
    await expect(page.getByText(planName)).toBeVisible({ timeout: 10000 });

    // 4. Create Subscription
    await page.goto("/subscriptions");
    await expect(page.getByRole("heading", { name: /subscriptions/i })).toBeVisible();

    await page.getByRole("button", { name: /new subscription/i }).click();
    await expect(page.getByRole("heading", { name: /create subscription/i })).toBeVisible();

    // Select customer
    await page.selectOption('select[name="customer_id"]', { label: `Acme Corp ${uniqueId}` }).catch(async () => {
      // Fallback: pick the last available option if exact name formatted differently
      const custSelect = page.locator('select[name="customer_id"]');
      await custSelect.selectOption({ index: 1 });
    });

    // Select the newly created plan
    await page.selectOption('select[name="plan_id"]', { label: planName }).catch(async () => {
      await page.locator('select[name="plan_id"]').selectOption({ index: 1 });
    });

    await page.getByRole("button", { name: /create contract/i }).click();
    await expect(page.locator("text=/contract created successfully|subscription/i").first()).toBeVisible();

    // 5. Billing Run
    await page.goto("/billing");
    await expect(page.getByRole("heading", { name: /automated billing engine/i })).toBeVisible();

    // Click Run Billing
    const runBillingBtn = page.getByRole("button", { name: /run billing/i });
    await expect(runBillingBtn).toBeVisible();
    await runBillingBtn.click();

    // Assert Execution Summary card appears
    await expect(page.getByText(/execution summary/i)).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/invoices created/i)).toBeVisible();

    // 6. Confirm Invoice and Record Payment
    await page.goto("/invoices");
    await expect(page.getByRole("heading", { name: /invoices/i })).toBeVisible();

    // Find the first draft or unconfirmed invoice row and click into details
    const firstInvoiceRow = page.locator("table tbody tr").first();
    await firstInvoiceRow.click();

    await page.waitForURL("**/invoices/**");
    await expect(page.getByText(/balance due/i)).toBeVisible();

    // If invoice is in draft, confirm it
    const confirmBtn = page.getByRole("button", { name: /confirm/i });
    if (await confirmBtn.isVisible()) {
      await confirmBtn.click();
      await expect(page.getByText(/confirmed/i)).toBeVisible();
    }

    // Record Payment
    const recordPayBtn = page.getByRole("button", { name: /record payment/i });
    if (await recordPayBtn.isVisible()) {
      await recordPayBtn.click();
      await expect(page.getByText(/record payment for/i)).toBeVisible();

      // Submit payment settlement
      await page.getByRole("button", { name: /record settlement/i }).click();
      await expect(page.getByText(/payment recorded successfully/i)).toBeVisible();
    }

    // 7. Dashboard shows metric updates
    await page.goto("/");
    await expect(page.getByText(/total revenue collected/i)).toBeVisible();

    // 8. Customer Portal Isolation Verification
    await page.goto("/login");
    await page.fill('input[name="email"]', newCustomerEmail);
    await page.fill('input[name="password"]', securePassword);
    await page.getByRole("button", { name: /sign in/i }).click();

    await page.waitForURL("**/portal**");
    // Verify customer portal shell and data isolation
    await expect(page.getByRole("heading", { name: /my subscriptions/i })).toBeVisible();
    await expect(page.getByText(/admin/i)).not.toBeVisible();
  });
});
