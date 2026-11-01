import { describe, it, expect, vi } from "vitest";
import { handleServerErrors, ServerApiError } from "../form-errors";

describe("handleServerErrors", () => {
  it("maps field-level server errors to react-hook-form setError and invokes toast", () => {
    const setError = vi.fn();
    const toast = { error: vi.fn() };

    const serverError: ServerApiError = {
      code: "VALIDATION_ERROR",
      message: "Validation failed",
      fields: {
        amount: "Maximum allowed payment is 100.00",
        paid_on: "Payment date cannot be in the future",
      },
    };

    const result = handleServerErrors(serverError, setError, toast);

    // Assert setError called for each field
    expect(setError).toHaveBeenCalledWith("amount", {
      type: "server",
      message: "Maximum allowed payment is 100.00",
    });
    expect(setError).toHaveBeenCalledWith("paid_on", {
      type: "server",
      message: "Payment date cannot be in the future",
    });

    // Assert toast notified with first field error
    expect(toast.error).toHaveBeenCalledWith("Maximum allowed payment is 100.00");
    expect(result).toBe("Maximum allowed payment is 100.00");
  });

  it("falls back to general server message when no fields are present", () => {
    const setError = vi.fn();
    const toast = { error: vi.fn() };

    const serverError: ServerApiError = {
      code: "INVOICE_ALREADY_PAID",
      message: "This invoice is already fully paid",
    };

    const result = handleServerErrors(serverError, setError, toast);

    expect(setError).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("This invoice is already fully paid");
    expect(result).toBe("This invoice is already fully paid");
  });

  it("falls back to fallbackMessage when error object contains no message or fields", () => {
    const setError = vi.fn();
    const toast = { error: vi.fn() };

    const result = handleServerErrors({}, setError, toast, "Custom fallback error");

    expect(setError).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("Custom fallback error");
    expect(result).toBe("Custom fallback error");
  });
});
