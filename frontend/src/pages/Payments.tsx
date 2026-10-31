import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/Dialog";
import { CreditCard, Search, Plus, CheckCircle, RefreshCw, Calendar, FileText } from "lucide-react";

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

export function Payments() {
  const queryClient = useQueryClient();
  const [methodFilter, setMethodFilter] = useState<string>("");
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");
  const [page, setPage] = useState<number>(1);
  const [pageSize] = useState<number>(20);

  // Record payment dialog state
  const [isDialogOpen, setIsDialogOpen] = useState<boolean>(false);
  const [invoiceId, setInvoiceId] = useState<string>("");
  const [amount, setAmount] = useState<string>("");
  const [method, setMethod] = useState<string>("card");
  const [paidOn, setPaidOn] = useState<string>(new Date().toISOString().split("T")[0]);
  const [note, setNote] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");

  const { data, isLoading, refetch } = useQuery({
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
    mutationFn: async () => {
      const idempotencyKey = `pay-${invoiceId}-${Date.now()}`;
      return api.post(
        "/payments",
        {
          invoice_id: parseInt(invoiceId, 10),
          amount: parseFloat(amount),
          method,
          paid_on: paidOn,
          note: note || undefined,
        },
        { "Idempotency-Key": idempotencyKey }
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["payments"] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-metrics"] });
      setIsDialogOpen(false);
      setInvoiceId("");
      setAmount("");
      setNote("");
      setErrorMessage("");
    },
    onError: (err: any) => {
      setErrorMessage(err.message || "Failed to record payment");
    },
  });

  const methodBadgeColors: Record<string, string> = {
    upi: "bg-purple-100 text-purple-800 border-purple-200",
    card: "bg-blue-100 text-blue-800 border-blue-200",
    bank_transfer: "bg-emerald-100 text-emerald-800 border-emerald-200",
    cash: "bg-amber-100 text-amber-800 border-amber-200",
    cheque: "bg-slate-100 text-slate-800 border-slate-200",
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
        <div className="flex items-center space-x-3">
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Button size="sm" onClick={() => setIsDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Record Payment
          </Button>
        </div>
      </div>

      {/* Filters Card */}
      <Card className="p-4 bg-white border border-slate-200">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">
              Payment Method
            </label>
            <select
              value={methodFilter}
              onChange={(e) => {
                setMethodFilter(e.target.value);
                setPage(1);
              }}
              className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
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
            <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">
              From Date
            </label>
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
            <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">
              To Date
            </label>
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
              className="w-full"
              onClick={() => {
                setMethodFilter("");
                setFromDate("");
                setToDate("");
                setPage(1);
              }}
            >
              Reset Filters
            </Button>
          </div>
        </div>
      </Card>

      {/* Payments Table */}
      <Card className="overflow-hidden border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-6 py-3 text-left font-semibold text-slate-600">ID</th>
                <th className="px-6 py-3 text-left font-semibold text-slate-600">Invoice ID</th>
                <th className="px-6 py-3 text-left font-semibold text-slate-600">Method</th>
                <th className="px-6 py-3 text-left font-semibold text-slate-600">Paid On</th>
                <th className="px-6 py-3 text-right font-semibold text-slate-600">Amount</th>
                <th className="px-6 py-3 text-left font-semibold text-slate-600">Note / Idempotency</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-slate-400">
                    Loading payments...
                  </td>
                </tr>
              ) : !data || data.items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-slate-400">
                    No payments found.
                  </td>
                </tr>
              ) : (
                data.items.map((pay) => (
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
                ))
              )}
            </tbody>
          </table>
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
      </Card>

      {/* Record Payment Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Record Payment</DialogTitle>
          </DialogHeader>

          {errorMessage && (
            <div className="p-3 text-xs bg-rose-50 text-rose-700 rounded-lg border border-rose-200">
              {errorMessage}
            </div>
          )}

          <div className="space-y-4 py-2">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Invoice ID *
              </label>
              <Input
                type="number"
                placeholder="e.g. 1"
                value={invoiceId}
                onChange={(e) => setInvoiceId(e.target.value)}
              />
              <span className="text-[11px] text-slate-400 mt-1 block">
                Enter the internal numeric ID of the confirmed invoice.
              </span>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Amount (INR) *
              </label>
              <Input
                type="number"
                step="0.01"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Payment Method *
              </label>
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
              >
                <option value="upi">UPI</option>
                <option value="card">Card</option>
                <option value="bank_transfer">Bank Transfer</option>
                <option value="cash">Cash</option>
                <option value="cheque">Cheque</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Payment Date *
              </label>
              <Input
                type="date"
                value={paidOn}
                onChange={(e) => setPaidOn(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Reference / Note (Optional)
              </label>
              <Input
                placeholder="UTR, transaction ID, or memo"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!invoiceId || !amount || recordPaymentMutation.isPending}
              onClick={() => recordPaymentMutation.mutate()}
            >
              {recordPaymentMutation.isPending ? "Recording..." : "Save Payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
