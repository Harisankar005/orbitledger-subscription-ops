import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { api } from "@/api/client";
import { formatCurrency, formatDate } from "@/lib/utils";
import { useToast } from "@/context/ToastContext";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/Dialog";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { positiveAmountSchema } from "@/lib/schemas";
import { handleServerErrors } from "@/lib/form-errors";
import { CreditCard, Plus } from "lucide-react";

interface PaymentItem {
  id: number;
  invoice_id: number;
  invoice_number?: string;
  customer_name?: string;
  method: "cash" | "card" | "upi" | "bank_transfer" | "cheque";
  amount: string | number;
  currency: string;
  paid_on: string;
  note?: string;
  idempotency_key?: string;
  recorded_by?: number;
  created_at: string;
}

const recordPaymentDirectSchema = z.object({
  invoice_id: z.number({ invalid_type_error: "Invoice ID must be a number" }).int().positive("Enter a valid Invoice ID"),
  amount: positiveAmountSchema,
  method: z.enum(["upi", "card", "bank_transfer", "cheque", "cash"]),
  paid_on: z.string().min(1, "Payment date is required").refine((d) => d <= new Date().toISOString().split("T")[0], "Payment date cannot be in the future"),
  note: z.string().optional(),
});
type RecordPaymentDirectFormData = z.infer<typeof recordPaymentDirectSchema>;

export function Payments() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [methodFilter, setMethodFilter] = useState<string>("");
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");
  const [page, setPage] = useState<number>(1);
  const [pageSize] = useState<number>(20);

  const [isDialogOpen, setIsDialogOpen] = useState<boolean>(false);
  const todayStr = new Date().toISOString().split("T")[0];

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<RecordPaymentDirectFormData>({
    resolver: zodResolver(recordPaymentDirectSchema),
    defaultValues: {
      invoice_id: 1,
      amount: 100,
      method: "card",
      paid_on: todayStr,
      note: "",
    },
  });

  const { data, isLoading } = useQuery({
    queryKey: ["payments", methodFilter, fromDate, toDate, page, pageSize],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: page.toString(),
        page_size: pageSize.toString(),
      });
      if (methodFilter) params.append("method", methodFilter);
      if (fromDate) params.append("from_date", fromDate);
      if (toDate) params.append("to_date", toDate);

      return api.get<{
        items: PaymentItem[];
        total: number;
        page: number;
        page_size: number;
      }>(`/payments?${params.toString()}`);
    },
  });

  const recordPaymentMutation = useMutation({
    mutationFn: async (formData: RecordPaymentDirectFormData) => {
      const idempotencyKey = `pay-${formData.invoice_id}-${Date.now()}`;
      return api.post(
        "/payments",
        {
          invoice_id: formData.invoice_id,
          amount: formData.amount,
          method: formData.method,
          paid_on: formData.paid_on,
          note: formData.note || undefined,
        },
        { "Idempotency-Key": idempotencyKey }
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payments"] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-metrics"] });
      toast.success("Payment transaction recorded successfully!");
      setIsDialogOpen(false);
      reset();
    },
    onError: (err: any) => handleServerErrors(err, setError, toast, "Failed to record payment"),
  });

  const methodBadgeColors: Record<string, string> = {
    upi: "bg-purple-100 text-purple-800 border-purple-200",
    card: "bg-blue-100 text-blue-800 border-blue-200",
    bank_transfer: "bg-emerald-100 text-emerald-800 border-emerald-200",
    cash: "bg-amber-100 text-amber-800 border-amber-200",
    cheque: "bg-slate-100 text-slate-800 border-slate-200",
  };

  const openModal = () => {
    reset({
      invoice_id: 1,
      amount: 100,
      method: "card",
      paid_on: todayStr,
      note: "",
    });
    setIsDialogOpen(true);
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Payments</h1>
          <p className="text-sm text-slate-500 mt-1">
            Track multi-method payments, partial settlements, and audit-logged transactions.
          </p>
        </div>
        <Button size="sm" onClick={openModal}>
          <Plus className="h-4 w-4 mr-1.5" />
          Record Payment
        </Button>
      </div>

      {/* Filter Bar */}
      <Card className="p-4 bg-white border border-slate-200">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Payment Method
            </label>
            <select
              value={methodFilter}
              onChange={(e) => {
                setMethodFilter(e.target.value);
                setPage(1);
              }}
              className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm bg-white"
            >
              <option value="">All Methods</option>
              <option value="upi">UPI</option>
              <option value="card">Card</option>
              <option value="bank_transfer">Bank Transfer</option>
              <option value="cash">Cash</option>
              <option value="cheque">Cheque</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">From Date</label>
            <Input
              type="date"
              value={fromDate}
              onChange={(e) => {
                setFromDate(e.target.value);
                setPage(1);
              }}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">To Date</label>
            <Input
              type="date"
              value={toDate}
              onChange={(e) => {
                setToDate(e.target.value);
                setPage(1);
              }}
            />
          </div>

          <div className="flex items-end">
            <Button
              variant="outline"
              size="sm"
              className="w-full h-10"
              onClick={() => {
                setMethodFilter("");
                setFromDate("");
                setToDate("");
                setPage(1);
              }}
            >
              Clear Filters
            </Button>
          </div>
        </div>
      </Card>

      {/* Payments Table */}
      <Card className="overflow-hidden border border-slate-200 bg-white">
        {isLoading ? (
          <div className="p-6">
            <TableSkeleton rows={5} cols={6} />
          </div>
        ) : !data || data.items.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={CreditCard}
              title="No payments found"
              description="Record a payment transaction against an active invoice."
              actionLabel="Record Payment"
              onAction={openModal}
            />
          </div>
        ) : (
          <>
            {/* Desktop Table View */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-6 py-3 text-left font-semibold text-slate-600">Payment ID</th>
                    <th className="px-6 py-3 text-left font-semibold text-slate-600">Invoice ID</th>
                    <th className="px-6 py-3 text-left font-semibold text-slate-600">Method</th>
                    <th className="px-6 py-3 text-left font-semibold text-slate-600">Paid On</th>
                    <th className="px-6 py-3 text-right font-semibold text-slate-600">Amount</th>
                    <th className="px-6 py-3 text-left font-semibold text-slate-600">Note / Idempotency</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {data.items.map((pay) => (
                    <tr key={pay.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-4 font-mono font-medium text-slate-900">#{pay.id}</td>
                      <td className="px-6 py-4">
                        <span className="font-mono text-indigo-600 font-semibold">
                          Invoice #{pay.invoice_id}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium uppercase border ${
                            methodBadgeColors[pay.method] || "bg-slate-100 text-slate-800 border-slate-200"
                          }`}
                        >
                          {pay.method.replace("_", " ")}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-slate-600">{formatDate(pay.paid_on)}</td>
                      <td className="px-6 py-4 text-right font-semibold text-slate-900">
                        {formatCurrency(pay.amount, pay.currency || "INR")}
                      </td>
                      <td className="px-6 py-4 text-xs text-slate-500 max-w-xs truncate">
                        {pay.note ? (
                          <div className="font-medium text-slate-700">{pay.note}</div>
                        ) : null}
                        {pay.idempotency_key && (
                          <div className="font-mono text-[11px] text-slate-400 truncate">
                            Key: {pay.idempotency_key}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Cards View (<640px) */}
            <div className="sm:hidden divide-y divide-slate-100">
              {data.items.map((pay) => (
                <div key={pay.id} className="p-4 space-y-2">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="font-semibold text-slate-900">Payment #{pay.id}</div>
                      <div className="font-mono text-xs text-indigo-600">Invoice #{pay.invoice_id}</div>
                    </div>
                    <span className="font-bold text-slate-900">
                      {formatCurrency(pay.amount, pay.currency || "INR")}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-xs text-slate-500 pt-1">
                    <span className="uppercase">{pay.method.replace("_", " ")}</span>
                    <span>{formatDate(pay.paid_on)}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Pagination */}
            {data && data.total > pageSize && (
              <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-between">
                <span className="text-xs text-slate-500">
                  Showing {(page - 1) * pageSize + 1} to{" "}
                  {Math.min(page * pageSize, data.total)} of {data.total} payments
                </span>
                <div className="flex space-x-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page * pageSize >= data.total}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </Card>

      {/* Record Payment Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Record Payment</DialogTitle>
          </DialogHeader>

          <form
            onSubmit={handleSubmit((data) => recordPaymentMutation.mutate(data))}
            className="space-y-4 py-2"
            noValidate
          >
            <Input
              label="Invoice ID"
              type="number"
              required
              placeholder="e.g. 1"
              error={errors.invoice_id?.message}
              {...register("invoice_id", { valueAsNumber: true })}
            />

            <Input
              label="Payment Amount"
              type="number"
              step="0.01"
              required
              placeholder="100.00"
              error={errors.amount?.message}
              {...register("amount", { valueAsNumber: true })}
            />

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Payment Method *
              </label>
              <select
                {...register("method")}
                className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm bg-white"
              >
                <option value="card">Credit / Debit Card</option>
                <option value="upi">UPI (Instant Transfer)</option>
                <option value="bank_transfer">Bank Transfer (NEFT/RTGS)</option>
                <option value="cheque">Cheque</option>
                <option value="cash">Cash</option>
              </select>
              {errors.method?.message && (
                <p className="mt-1 text-xs text-rose-600">{errors.method.message}</p>
              )}
            </div>

            <Input
              label="Payment Date"
              type="date"
              required
              max={todayStr}
              error={errors.paid_on?.message}
              {...register("paid_on")}
            />

            <Input
              label="Notes / Transaction Reference"
              placeholder="e.g. Card auth code, check number"
              error={errors.note?.message}
              {...register("note")}
            />

            <DialogFooter>
              <Button variant="outline" type="button" onClick={() => setIsDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                isLoading={recordPaymentMutation.isPending || isSubmitting}
                disabled={recordPaymentMutation.isPending || isSubmitting}
              >
                Save Payment
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
