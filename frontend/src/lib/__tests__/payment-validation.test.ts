import { describe, it, expect } from "vitest";
import { createPaymentSchema } from "../schemas";

describe("createPaymentSchema", () => {
  const todayStr = new Date().toISOString().split("T")[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split("T")[0];

  it("accepts a valid payment payload within balance due", () => {
    const schema = createPaymentSchema(100.0);
    const validData = {
      method: "upi",
      amount: 49.99,
      payment_date: todayStr,
      reference: "UPI/12345/TXN",
    };

    const result = schema.safeParse(validData);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.amount).toBe(49.99);
      expect(result.data.method).toBe("upi");
    }
  });

  it("accepts payment equal to the exact balance due", () => {
    const schema = createPaymentSchema(150.0);
    const result = schema.safeParse({
      method: "bank_transfer",
      amount: 150.0,
      payment_date: yesterday,
    });

    expect(result.success).toBe(true);
  });

  it("rejects non-positive payment amounts", () => {
    const schema = createPaymentSchema(100.0);

    const zeroResult = schema.safeParse({
      method: "cash",
      amount: 0,
      payment_date: todayStr,
    });
    expect(zeroResult.success).toBe(false);
    if (!zeroResult.success) {
      expect(zeroResult.error.issues[0].message).toMatch(/Must be greater than 0/i);
    }

    const negResult = schema.safeParse({
      method: "cash",
      amount: -25.5,
      payment_date: todayStr,
    });
    expect(negResult.success).toBe(false);
    if (!negResult.success) {
      expect(negResult.error.issues[0].message).toMatch(/Must be greater than 0/i);
    }
  });

  it("rejects payment amounts with more than 2 decimal places", () => {
    const schema = createPaymentSchema(100.0);
    const result = schema.safeParse({
      method: "card",
      amount: 15.123,
      payment_date: todayStr,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/at most 2 decimal places/i);
    }
  });

  it("rejects payment amounts that exceed the balance due", () => {
    const schema = createPaymentSchema(100.0);
    const result = schema.safeParse({
      method: "card",
      amount: 100.01,
      payment_date: todayStr,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.includes("amount"));
      expect(issue).toBeDefined();
      expect(issue?.message).toMatch(/Payment amount cannot exceed the balance due/i);
    }
  });

  it("rejects payment dates in the future", () => {
    const schema = createPaymentSchema(200.0);
    const result = schema.safeParse({
      method: "upi",
      amount: 50.0,
      payment_date: tomorrow,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.includes("payment_date"));
      expect(issue).toBeDefined();
      expect(issue?.message).toMatch(/Payment date cannot be in the future/i);
    }
  });

  it("rejects invalid payment methods", () => {
    const schema = createPaymentSchema(100.0);
    const result = schema.safeParse({
      method: "crypto_token",
      amount: 50.0,
      payment_date: todayStr,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path.includes("method"));
      expect(issue).toBeDefined();
      expect(issue?.message).toMatch(/Select a valid payment method/i);
    }
  });
});
