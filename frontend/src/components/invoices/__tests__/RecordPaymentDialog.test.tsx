import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { RecordPaymentDialog } from "../RecordPaymentDialog";

describe("RecordPaymentDialog Component", () => {
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split("T")[0];

  it("renders with default values and prefilled balance due", () => {
    const onOpenChange = vi.fn();
    const onSubmit = vi.fn();

    render(
      <RecordPaymentDialog
        open={true}
        onOpenChange={onOpenChange}
        invoiceNumber="INV-2026-0042"
        balanceDue={150.0}
        currency="USD"
        onSubmit={onSubmit}
      />
    );

    expect(screen.getByText("Record Payment for INV-2026-0042")).toBeInTheDocument();
    expect(screen.getByDisplayValue("150")).toBeInTheDocument();
    expect(screen.getByText(/Max balance due: \$150\.00/i)).toBeInTheDocument();
  });

  it("displays validation error when overpaying beyond balance due", async () => {
    const onOpenChange = vi.fn();
    const onSubmit = vi.fn();

    render(
      <RecordPaymentDialog
        open={true}
        onOpenChange={onOpenChange}
        invoiceNumber="INV-2026-0042"
        balanceDue={100.0}
        currency="USD"
        onSubmit={onSubmit}
      />
    );

    const amountInput = screen.getByLabelText(/Payment Amount/i);
    fireEvent.change(amountInput, { target: { value: "150.00" } });

    const submitBtn = screen.getByRole("button", { name: /Record Settlement/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(
        screen.getByText(/Payment amount cannot exceed the balance due/i)
      ).toBeInTheDocument();
    });

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("displays validation error when payment date is in the future", async () => {
    const onOpenChange = vi.fn();
    const onSubmit = vi.fn();

    render(
      <RecordPaymentDialog
        open={true}
        onOpenChange={onOpenChange}
        invoiceNumber="INV-2026-0042"
        balanceDue={100.0}
        currency="USD"
        onSubmit={onSubmit}
      />
    );

    const dateInput = screen.getByLabelText(/Payment Date/i);
    fireEvent.change(dateInput, { target: { value: tomorrow } });

    const submitBtn = screen.getByRole("button", { name: /Record Settlement/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(
        screen.getByText(/Payment date cannot be in the future/i)
      ).toBeInTheDocument();
    });

    expect(onSubmit).not.toHaveBeenCalled();
  });
});
