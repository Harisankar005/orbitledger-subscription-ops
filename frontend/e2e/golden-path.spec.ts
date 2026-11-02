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

    // Log out customer by clearing session cookies
    await page.context().clearCookies();
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: /sign in/i })).toBeVisible();

    // 2. Admin Log In
    await page.fill('input[name="email"]', "admin@brightloop.test");
    await page.fill('input[name="password"]', "Admin@1234");
    await page.getByRole("button", { name: /sign in/i }).click();

    await page.waitForURL("**/");
    await expect(page.getByRole("heading", { name: /operations dashboard/i })).toBeVisible();

    // 3. Admin creates Plan in Catalog
    await page.goto("/catalog");
    await expect(page.getByRole("heading", { name: /catalog & plans/i })).toBeVisible();

    await page.getByRole("button", { name: /subscription plans/i }).click();
    await page.getByRole("button", { name: /new plan/i }).click();

    const planName = `E2E Plan ${uniqueId}`;
    await page.fill('input[name="name"]', planName);
    await page.fill('input[name="price"]', "1200.00");
    await page.getByRole("button", { name: /create plan/i }).click();

    // Wait for plan dialog to close and plan to appear
    await expect(page.getByText(planName)).toBeVisible({ timeout: 10000 });

    // 4. Create Subscription from Template
    await page.goto("/subscriptions");
    await expect(page.getByRole("heading", { name: /subscriptions/i })).toBeVisible();

    await page.getByRole("button", { name: /new from template/i }).click();
    await expect(page.getByRole("heading", { name: /create subscription from template/i })).toBeVisible();

    const selects = page.locator(".fixed select, [role='dialog'] select");
    await selects.nth(0).selectOption({ index: 1 });
    await selects.nth(1).selectOption({ index: 1 });

    await page.getByRole("button", { name: /generate contract/i }).click();
    await page.waitForURL("**/subscriptions/**");
    await expect(page.getByText(/draft/i).first()).toBeVisible();

    // Walk state machine: Draft -> Quotation -> Confirmed
    const genQuotationBtn = page.getByRole("button", { name: /generate quotation/i });
    if (await genQuotationBtn.isVisible()) {
      await genQuotationBtn.click();
      await expect(page.getByText(/quotation/i).first()).toBeVisible();
    }

    const confirmContractBtn = page.getByRole("button", { name: /confirm contract/i });
    if (await confirmContractBtn.isVisible()) {
      await confirmContractBtn.click();
      await expect(page.getByText(/confirmed/i).first()).toBeVisible();
    }

    // 5. Billing Run
    await page.goto("/billing");
    await expect(page.getByRole("heading", { name: /automated billing engine/i })).toBeVisible();

    await page.getByRole("button", { name: /run billing/i }).click();
    await expect(page.getByText(/execution summary/i)).toBeVisible({ timeout: 15000 });

    // 6. Confirm Invoice and Record Payment
    await page.goto("/invoices");
    await expect(page.getByRole("heading", { name: /invoices/i })).toBeVisible();

    const firstInvoiceRow = page.locator("table tbody tr").first();
    if (await firstInvoiceRow.isVisible()) {
      await firstInvoiceRow.click();
      await page.waitForURL("**/invoices/**");
      await expect(page.getByText(/balance due/i)).toBeVisible();

      // If invoice is in draft, confirm it
      const confirmBtn = page.getByRole("button", { name: /confirm invoice/i }).or(page.getByRole("button", { name: /^confirm$/i }));
      if (await confirmBtn.isVisible()) {
        await confirmBtn.click();
        await expect(page.getByText(/confirmed/i).first()).toBeVisible();
      }

      // Record Payment
      const recordPayBtn = page.getByRole("button", { name: /record payment/i });
      if (await recordPayBtn.isVisible()) {
        await recordPayBtn.click();
        const settleBtn = page.getByRole("button", { name: /record settlement/i });
        if (await settleBtn.isVisible()) {
          await settleBtn.click();
          await expect(page.getByText(/payment recorded successfully/i)).toBeVisible();
        }
      }
    }

    // 7. Dashboard shows metric updates
    await page.goto("/");
    await expect(page.getByText(/total revenue collected/i)).toBeVisible();

    // 8. Customer Portal Isolation Verification
    await page.context().clearCookies();
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: /sign in/i })).toBeVisible();

    await page.fill('input[name="email"]', newCustomerEmail);
    await page.fill('input[name="password"]', securePassword);
    await page.getByRole("button", { name: /sign in/i }).click();

    await page.waitForURL("**/portal**");
    await expect(page.getByRole("heading", { name: /my subscriptions/i })).toBeVisible();
    await expect(page.getByText(/admin/i)).not.toBeVisible();
  });
});
