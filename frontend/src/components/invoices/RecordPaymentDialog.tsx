import React, { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { createPaymentSchema, PaymentFormData } from "@/lib/schemas";
import { formatCurrency } from "@/lib/utils";

export interface RecordPaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceNumber: string;
  balanceDue: number;
  currency: string;
  onSubmit: (data: PaymentFormData) => void;
  isLoading?: boolean;
}

export function RecordPaymentDialog({
  open,
  onOpenChange,
  invoiceNumber,
  balanceDue,
  currency,
  onSubmit,
  isLoading = false,
}: RecordPaymentDialogProps) {
  const todayStr = new Date().toISOString().split("T")[0];

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<PaymentFormData>({
    resolver: zodResolver(createPaymentSchema(balanceDue)),
    defaultValues: {
      method: "upi",
      amount: balanceDue,
      payment_date: todayStr,
      reference: "",
    },
  });

  useEffect(() => {
    if (open) {
      reset({
        method: "upi",
        amount: balanceDue,
        payment_date: todayStr,
        reference: "",
      });
    }
  }, [open, balanceDue, todayStr, reset]);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Record Payment for ${invoiceNumber}`}
      description="Enter payment settlement details with idempotency verification"
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 pt-2" noValidate>
        <div>
          <label htmlFor="payment-method-select" className="block text-sm font-medium text-slate-700 mb-1">
            Payment Method *
          </label>
          <select
            id="payment-method-select"
            {...register("method")}
            className="w-full h-11 px-3 rounded-lg border border-slate-300 bg-white text-sm"
          >
            <option value="upi">UPI (Instant Transfer)</option>
            <option value="card">Credit / Debit Card</option>
            <option value="bank_transfer">Bank Transfer (NEFT/RTGS)</option>
            <option value="cheque">Cheque</option>
            <option value="cash">Cash</option>
          </select>
          {errors.method?.message && (
            <p className="mt-1 text-xs text-rose-600">{errors.method.message}</p>
          )}
        </div>

        <Input
          label="Payment Amount"
          type="number"
          step="0.01"
          min="0.01"
          max={balanceDue}
          required
          helperText={`Max balance due: ${formatCurrency(balanceDue, currency)}`}
          error={errors.amount?.message}
          {...register("amount", { valueAsNumber: true })}
        />

        <Input
          label="Payment Date"
          type="date"
          required
          max={todayStr}
          helperText="Cannot be in the future"
          error={errors.payment_date?.message}
          {...register("payment_date")}
        />

        <Input
          label="Reference / Transaction Note"
          placeholder="UTR or Cheque number"
          error={errors.reference?.message}
          {...register("reference")}
        />

        <div className="flex justify-end space-x-2 pt-4">
          <Button variant="outline" type="button" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="submit"
            isLoading={isLoading || isSubmitting}
            disabled={isLoading || isSubmitting}
          >
            Record Settlement
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
