import React, { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { api } from "@/api/client";
import { formatCurrency, formatDate } from "@/lib/utils";
import { useToast } from "@/context/ToastContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { Dialog } from "@/components/ui/Dialog";
import { createPaymentSchema, PaymentFormData } from "@/lib/schemas";
import { handleServerErrors } from "@/lib/form-errors";
import {
  ArrowLeft,
  Printer,
  Mail,
  Check,
  XCircle,
  CreditCard,
} from "lucide-react";

export function InvoiceDetail() {
  const { id } = useParams<{ id: string }>();
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const invQuery = useQuery<any>({
    queryKey: ["invoices", id],
    queryFn: () => api.get(`/invoices/${id}`),
    enabled: !!id,
  });

  const inv = invQuery.data;
  const balanceDue = inv ? Math.max(0, inv.total - inv.amount_paid) : 0;
  const todayStr = new Date().toISOString().split("T")[0];

  const paymentForm = useForm<PaymentFormData>({
    resolver: zodResolver(createPaymentSchema(balanceDue)),
    defaultValues: {
      method: "upi",
      amount: balanceDue,
      payment_date: todayStr,
      reference: "",
    },
  });

  useEffect(() => {
    if (balanceDue > 0) {
      paymentForm.setValue("amount", balanceDue);
    }
  }, [balanceDue, paymentForm]);

  const confirmMutation = useMutation({
    mutationFn: () => api.post(`/invoices/${id}/confirm`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices", id] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      toast.success("Invoice confirmed successfully!");
    },
    onError: (err: any) => toast.error(err.message || "Failed to confirm invoice"),
  });

  const cancelMutation = useMutation({
    mutationFn: () => api.post(`/invoices/${id}/cancel`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices", id] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      toast.success("Invoice cancelled.");
    },
    onError: (err: any) => toast.error(err.message || "Failed to cancel invoice"),
  });

  const sendMutation = useMutation({
    mutationFn: () => api.post(`/invoices/${id}/send`),
    onSuccess: () => {
      toast.success("Invoice dispatched to Outbox and Mailpit successfully!");
      queryClient.invalidateQueries({ queryKey: ["invoices", id] });
    },
    onError: (err: any) => toast.error(err.message || "Failed to send invoice"),
  });

  const recordPaymentMutation = useMutation({
    mutationFn: (data: PaymentFormData) =>
      api.post(`/invoices/${id}/payments`, {
        method: data.method,
        amount: data.amount,
        paid_on: data.payment_date,
        note: data.reference || undefined,
      }),
    onSuccess: () => {
      setPaymentModalOpen(false);
      queryClient.invalidateQueries({ queryKey: ["invoices", id] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["reports"] });
      toast.success("Payment recorded successfully!");
      paymentForm.reset();
    },
    onError: (err: any) =>
      handleServerErrors(err, paymentForm.setError, toast, "Failed to record payment"),
  });

  if (invQuery.isLoading) {
    return <div className="p-8 text-center text-slate-500">Loading invoice details...</div>;
  }

  if (!inv) {
    return <div className="p-8 text-center text-slate-500">Invoice not found</div>;
  }

  const handleOpenPayment = () => {
    paymentForm.reset({
      method: "upi",
      amount: balanceDue,
      payment_date: todayStr,
      reference: "",
    });
    setPaymentModalOpen(true);
  };

  return (
    <div className="space-y-6">
      {/* Top Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center space-x-3">
          <Link to="/invoices" className="p-2 rounded-lg hover:bg-slate-200 transition-colors">
            <ArrowLeft className="h-5 w-5 text-slate-600" />
          </Link>
          <div>
            <div className="flex items-center space-x-3">
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">{inv.number}</h1>
              <Badge status={inv.payment_status || inv.status} />
            </div>
            <p className="text-sm text-slate-500">Customer: {inv.customer?.name} ({inv.customer?.email})</p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <a href={`/api/invoices/${inv.id}/print`} target="_blank" rel="noreferrer">
            <Button variant="outline" size="sm">
              <Printer className="h-4 w-4 mr-1.5" /> Print PDF
            </Button>
          </a>

          {inv.status === "draft" && (
            <Button size="sm" onClick={() => confirmMutation.mutate()} isLoading={confirmMutation.isPending} disabled={confirmMutation.isPending}>
              <Check className="h-4 w-4 mr-1.5" /> Confirm Invoice
            </Button>
          )}

          {inv.status === "confirmed" && (
            <>
              <Button size="sm" variant="outline" onClick={() => sendMutation.mutate()} isLoading={sendMutation.isPending} disabled={sendMutation.isPending}>
                <Mail className="h-4 w-4 mr-1.5 text-blue-600" /> Send Email
              </Button>

              {balanceDue > 0 && (
                <Button size="sm" onClick={handleOpenPayment}>
                  <CreditCard className="h-4 w-4 mr-1.5" /> Record Payment
                </Button>
              )}

              {inv.amount_paid === 0 && (
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => {
                    if (confirm("Are you sure you want to cancel this invoice?")) {
                      cancelMutation.mutate();
                    }
                  }}
                  isLoading={cancelMutation.isPending}
                  disabled={cancelMutation.isPending}
                >
                  <XCircle className="h-4 w-4 mr-1.5" /> Cancel
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-slate-500 uppercase tracking-wider">Invoice Metadata</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-600">Issue Date:</span>
              <span className="font-medium text-slate-900">{formatDate(inv.issue_date)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600">Due Date:</span>
              <span className="font-semibold text-slate-900">{formatDate(inv.due_date)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600">Subscription Period:</span>
              <span className="font-medium text-slate-900">
                {formatDate(inv.period_start)} to {formatDate(inv.period_end)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600">Sent Status:</span>
              <span className="text-xs text-slate-500">
                {inv.sent_at ? `Sent ${new Date(inv.sent_at).toLocaleDateString()}` : "Not sent yet"}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-slate-500 uppercase tracking-wider">Financial Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-600">Subtotal:</span>
              <span className="font-medium text-slate-900">{formatCurrency(inv.subtotal, inv.currency)}</span>
            </div>
            {inv.discount_total > 0 && (
              <div className="flex justify-between text-emerald-600">
                <span>Discounts Applied:</span>
                <span>-{formatCurrency(inv.discount_total, inv.currency)}</span>
              </div>
            )}
            <div className="flex justify-between text-slate-600">
              <span>Taxes:</span>
              <span>+{formatCurrency(inv.tax_total, inv.currency)}</span>
            </div>
            <div className="flex justify-between pt-2 border-t border-slate-100 font-bold text-base text-slate-900">
              <span>Grand Total:</span>
              <span>{formatCurrency(inv.total, inv.currency)}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-slate-500 uppercase tracking-wider">Settlement Balance</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <div className="text-xs text-slate-500">Amount Paid</div>
              <div className="text-lg font-bold text-emerald-600">
                {formatCurrency(inv.amount_paid, inv.currency)}
              </div>
            </div>
            <div className="pt-2 border-t border-slate-100">
              <div className="text-xs text-slate-500">Balance Due</div>
              <div className={`text-2xl font-black ${balanceDue > 0 ? "text-rose-600" : "text-emerald-700"}`}>
                {formatCurrency(balanceDue, inv.currency)}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Line Items Table */}
      <Card>
        <CardHeader>
          <CardTitle>Invoice Line Items</CardTitle>
          <CardDescription>Billed recurring and service items with individual tax rates</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-500 uppercase text-xs border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3">Description</th>
                  <th className="px-4 py-3 text-center">Quantity</th>
                  <th className="px-4 py-3 text-right">Unit Price</th>
                  <th className="px-4 py-3 text-right">Tax Details</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {inv.lines?.map((line: any) => (
                  <tr key={line.id}>
                    <td className="px-4 py-3 font-medium text-slate-900">{line.description}</td>
                    <td className="px-4 py-3 text-center">{line.quantity}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(line.unit_price, inv.currency)}</td>
                    <td className="px-4 py-3 text-right text-xs text-slate-500">
                      {line.tax_rate ? `${line.tax_name || "Tax"} (${line.tax_rate}%)` : "Exempt"}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-900">
                      {formatCurrency(line.amount, inv.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Applied Discounts Summary */}
      {inv.applied_discounts?.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Applied Promotional Discounts</CardTitle>
            <CardDescription>Single-best discount rules evaluated and granted</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {inv.applied_discounts.map((d: any) => (
                <div key={d.id} className="flex justify-between items-center text-sm p-3 bg-slate-50 rounded-lg">
                  <div>
                    <span className="font-semibold text-slate-900">{d.rule?.name}</span>
                    <span className="text-xs text-slate-500 ml-2">({d.rule?.scope} scope)</span>
                  </div>
                  <div className="font-bold text-emerald-600">
                    -{formatCurrency(d.deduction, inv.currency)}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recorded Payment Transactions */}
      <Card>
        <CardHeader>
          <CardTitle>Payment History</CardTitle>
          <CardDescription>Multi-method settlement transactions with idempotency auditing</CardDescription>
        </CardHeader>
        <CardContent>
          {inv.payments?.length === 0 ? (
            <div className="text-center py-6 text-sm text-slate-400">No payment records logged yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-slate-500 uppercase text-xs border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3">Transaction #</th>
                    <th className="px-4 py-3">Method</th>
                    <th className="px-4 py-3">Paid Date</th>
                    <th className="px-4 py-3 text-right">Settled Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {inv.payments.map((p: any) => (
                    <tr key={p.id}>
                      <td className="px-4 py-3 font-mono font-medium text-slate-800">{p.number}</td>
                      <td className="px-4 py-3 capitalize text-slate-600">{p.method?.replace("_", " ")}</td>
                      <td className="px-4 py-3 text-slate-600">{formatDate(p.payment_date || p.paid_on)}</td>
                      <td className="px-4 py-3 text-right font-bold text-emerald-600">
                        {formatCurrency(p.amount, inv.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Record Payment Dialog */}
      <Dialog
        open={paymentModalOpen}
        onOpenChange={setPaymentModalOpen}
        title={`Record Payment for ${inv.number}`}
        description="Enter payment settlement details with idempotency verification"
      >
        <form
          onSubmit={paymentForm.handleSubmit((data) => recordPaymentMutation.mutate(data))}
          className="space-y-4 pt-2"
          noValidate
        >
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Payment Method *</label>
            <select
              {...paymentForm.register("method")}
              className="w-full h-11 px-3 rounded-lg border border-slate-300 bg-white text-sm"
            >
              <option value="upi">UPI (Instant Transfer)</option>
              <option value="card">Credit / Debit Card</option>
              <option value="bank_transfer">Bank Transfer (NEFT/RTGS)</option>
              <option value="cheque">Cheque</option>
              <option value="cash">Cash</option>
            </select>
            {paymentForm.formState.errors.method?.message && (
              <p className="mt-1 text-xs text-rose-600">{paymentForm.formState.errors.method.message}</p>
            )}
          </div>

          <Input
            label="Payment Amount"
            type="number"
            step="0.01"
            min="0.01"
            max={balanceDue}
            required
            helperText={`Max balance due: ${formatCurrency(balanceDue, inv.currency)}`}
            error={paymentForm.formState.errors.amount?.message}
            {...paymentForm.register("amount", { valueAsNumber: true })}
          />

          <Input
            label="Payment Date"
            type="date"
            required
            max={todayStr}
            helperText="Cannot be in the future"
            error={paymentForm.formState.errors.payment_date?.message}
            {...paymentForm.register("payment_date")}
          />

          <Input
            label="Reference / Transaction Note"
            placeholder="UTR or Cheque number"
            error={paymentForm.formState.errors.reference?.message}
            {...paymentForm.register("reference")}
          />

          <div className="flex justify-end space-x-2 pt-4">
            <Button variant="outline" type="button" onClick={() => setPaymentModalOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              isLoading={recordPaymentMutation.isPending || paymentForm.formState.isSubmitting}
              disabled={recordPaymentMutation.isPending || paymentForm.formState.isSubmitting}
            >
              Record Settlement
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
