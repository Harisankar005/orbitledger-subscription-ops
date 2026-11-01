import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BillingExecutionSummary, BillingRunResult } from "../Billing";

describe("BillingExecutionSummary Component", () => {
  const mockDryRunResult: BillingRunResult = {
    created: 14,
    skipped_already_billed: 5,
    skipped_not_due: 20,
    remaining_due: 3,
    failed: [
      {
        subscription_id: 101,
        subscription_number: "SUB-00101",
        reason: "Customer billing address invalid",
      },
    ],
    duration_ms: 125,
    dry_run: true,
    as_of_date: "2026-06-01",
  };

  it("renders dry-run execution summary metrics correctly", () => {
    const onRunAgain = vi.fn();
    render(<BillingExecutionSummary result={mockDryRunResult} onRunAgain={onRunAgain} />);

    // Assert badges and titles
    expect(screen.getByText("Execution Summary")).toBeInTheDocument();
    expect(screen.getByText("DRY RUN (Simulated)")).toBeInTheDocument();
    expect(screen.getByText("Processed in 125 ms")).toBeInTheDocument();

    // Assert metric counters
    expect(screen.getByText("14")).toBeInTheDocument(); // Invoices Created
    expect(screen.getByText("5")).toBeInTheDocument(); // Already Billed
    expect(screen.getByText("20")).toBeInTheDocument(); // Not Due
    expect(screen.getByText("1")).toBeInTheDocument(); // Failed Subscriptions

    // Assert remaining due banner
    expect(screen.getByText(/3 cycle\(s\) remaining/i)).toBeInTheDocument();

    // Assert exception list
    expect(screen.getByText("SUB-00101")).toBeInTheDocument();
    expect(screen.getByText("Customer billing address invalid")).toBeInTheDocument();

    // Click "Run Billing Again"
    const runAgainBtn = screen.getByRole("button", { name: /run billing again/i });
    fireEvent.click(runAgainBtn);
    expect(onRunAgain).toHaveBeenCalledTimes(1);
  });

  it("renders production committed mode and hides remaining due banner when remaining_due is 0", () => {
    const prodResult: BillingRunResult = {
      created: 25,
      skipped_already_billed: 0,
      skipped_not_due: 10,
      remaining_due: 0,
      failed: [],
      duration_ms: 85,
      dry_run: false,
      as_of_date: "2026-06-01",
    };

    render(<BillingExecutionSummary result={prodResult} />);

    expect(screen.getByText("PRODUCTION COMMITTED")).toBeInTheDocument();
    expect(screen.queryByText(/remaining due periods/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Exceptions Encountered")).not.toBeInTheDocument();
  });
});
