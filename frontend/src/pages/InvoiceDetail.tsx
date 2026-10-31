import React, { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { Dialog } from "@/components/ui/Dialog";
import {
  ArrowLeft,
  Printer,
  Mail,
  Check,
  XCircle,
  CreditCard,
  DollarSign,
  AlertCircle,
} from "lucide-react";

export function InvoiceDetail() {
  const { id } = useParams<{ id: string }>();
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState("upi");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split("T")[0]);
  const [paymentNote, setPaymentNote] = useState("");

  const queryClient = useQueryClient();

  const invQuery = useQuery<any>({
    queryKey: ["invoices", id],
    queryFn: () => api.get(`/invoices/${id}`),
    enabled: !!id,
  });

  const confirmMutation = useMutation({
    mutationFn: () => api.post(`/invoices/${id}/confirm`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices", id] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
    },
    onError: (err: any) => alert(err.message || "Failed to confirm"),
  });

  const cancelMutation = useMutation({
    mutationFn: () => api.post(`/invoices/${id}/cancel`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices", id] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
    },
    onError: (err: any) => alert(err.message || "Failed to cancel"),
  });

  const sendMutation = useMutation({
    mutationFn: () => api.post(`/invoices/${id}/send`),
    onSuccess: () => {
      alert("Invoice dispatched to Outbox and Mailpit successfully!");
      queryClient.invalidateQueries({ queryKey: ["invoices", id] });
    },
    onError: (err: any) => alert(err.message || "Failed to send"),
  });

  const recordPaymentMutation = useMutation({
    mutationFn: (data: any) => api.post(`/invoices/${id}/payments`, data),
    onSuccess: () => {
      setPaymentModalOpen(false);
      queryClient.invalidateQueries({ queryKey: ["invoices", id] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["reports"] });
    },
    onError: (err: any) => alert(`Payment Failed: ${err.message}`),
  });

  if (invQuery.isLoading) {
    return <div className="p-8 text-center text-slate-500">Loading invoice...</div>;
  }

  const inv = invQuery.data;
  if (!inv) {
    return <div className="p-8 text-center text-slate-500">Invoice not found</div>;
  }

  const balanceDue = Math.max(0, inv.total - inv.amount_paid);

  const handleOpenPayment = () => {
    setPaymentAmount(balanceDue.toFixed(2));
    setPaymentModalOpen(true);
  };

  const handlePaymentSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    recordPaymentMutation.mutate({
      method: paymentMethod,
      amount: parseFloat(paymentAmount),
      paid_on: paymentDate,
      note: paymentNote,
    });
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

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2">
          <a href={`/api/invoices/${inv.id}/print`} target="_blank" rel="noreferrer">
            <Button variant="outline" size="sm">
              <Printer className="h-4 w-4 mr-1.5" /> Print PDF
            </Button>
          </a>

          {inv.status === "draft" && (
            <Button size="sm" onClick={() => confirmMutation.mutate()} isLoading={confirmMutation.isPending}>
              <Check className="h-4 w-4 mr-1.5" /> Confirm Invoice
            </Button>
          )}

          {inv.status === "confirmed" && (
            <>
              <Button size="sm" variant="outline" onClick={() => sendMutation.mutate()} isLoading={sendMutation.isPending}>
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
            <CardTitle className="text-sm text-slate-500 uppercase tracking-wider">Customer Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            <div className="font-bold text-slate-900">{inv.customer?.name}</div>
            <div className="text-slate-600">{inv.customer?.company || "Individual Account"}</div>
            <div className="text-slate-600">{inv.customer?.email}</div>
            {inv.customer?.tax_id && (
              <div className="text-xs text-slate-500 pt-1">GST/Tax ID: {inv.customer.tax_id}</div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-slate-500 uppercase tracking-wider">Balance & Receivables</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-600">Total Invoice Amount:</span>
              <span className="font-bold text-slate-900">{formatCurrency(inv.total, inv.currency)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600">Amount Paid:</span>
              <span className="font-semibold text-emerald-700">{formatCurrency(inv.amount_paid, inv.currency)}</span>
            </div>
            <div className="flex justify-between pt-2 border-t border-slate-100">
              <span className="font-semibold text-slate-900">Balance Due:</span>
              <span className={`font-extrabold ${balanceDue > 0 ? "text-rose-600" : "text-emerald-700"}`}>
                {formatCurrency(balanceDue, inv.currency)}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Invoice Lines Table */}
      <Card>
        <CardHeader>
          <CardTitle>Billed Items & Calculations</CardTitle>
          <CardDescription>Plan base recurring fee and line item components with snapshot tax calculation</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-500 uppercase text-xs border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3">Item / Description</th>
                  <th className="px-4 py-3 text-center">Qty</th>
                  <th className="px-4 py-3 text-right">Unit Price</th>
                  <th className="px-4 py-3 text-right">Discount</th>
                  <th className="px-4 py-3 text-right">Tax</th>
                  <th className="px-4 py-3 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {inv.lines?.map((line: any) => (
                  <tr key={line.id}>
                    <td className="px-4 py-3.5">
                      <div className="font-medium text-slate-900">{line.description}</div>
                      <div className="text-xs text-slate-400 capitalize">{line.source.replace("_", " ")}</div>
                    </td>
                    <td className="px-4 py-3.5 text-center">{line.quantity}</td>
                    <td className="px-4 py-3.5 text-right">{formatCurrency(line.unit_price, inv.currency)}</td>
                    <td className="px-4 py-3.5 text-right text-emerald-700">
                      {line.discount_amount > 0 ? `-${formatCurrency(line.discount_amount, inv.currency)}` : "-"}
                    </td>
                    <td className="px-4 py-3.5 text-right text-slate-600">
                      {formatCurrency(line.tax_amount, inv.currency)}
                    </td>
                    <td className="px-4 py-3.5 text-right font-bold text-slate-900">
                      {formatCurrency(line.line_total, inv.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Totals Summary */}
          <div className="mt-6 flex justify-end">
            <div className="w-full max-w-xs space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-600">Subtotal:</span>
                <span className="font-medium text-slate-900">{formatCurrency(inv.subtotal, inv.currency)}</span>
              </div>
              <div className="flex justify-between text-emerald-700">
                <span>Discounts Total:</span>
                <span>-{formatCurrency(inv.discount_total, inv.currency)}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Taxes Total:</span>
                <span>+{formatCurrency(inv.tax_total, inv.currency)}</span>
              </div>
              <div className="flex justify-between pt-2 border-t-2 border-indigo-600 text-base font-bold text-slate-900">
                <span>Grand Total:</span>
                <span>{formatCurrency(inv.total, inv.currency)}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Payments History */}
      <Card>
        <CardHeader>
          <CardTitle>Recorded Payment Receipts</CardTitle>
          <CardDescription>Immutable audit trail of settlements received against this invoice</CardDescription>
        </CardHeader>
        <CardContent>
          {inv.payments?.length === 0 ? (
            <div className="text-center py-6 text-slate-400 text-sm">No payments recorded yet</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-slate-500 uppercase text-xs border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-2.5">Date</th>
                    <th className="px-4 py-2.5">Method</th>
                    <th className="px-4 py-2.5">Note</th>
                    <th className="px-4 py-2.5 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {inv.payments?.map((p: any) => (
                    <tr key={p.id}>
                      <td className="px-4 py-3">{formatDate(p.paid_on)}</td>
                      <td className="px-4 py-3 uppercase text-xs font-semibold text-slate-700">{p.method}</td>
                      <td className="px-4 py-3 text-slate-500">{p.note || "-"}</td>
                      <td className="px-4 py-3 text-right font-bold text-emerald-700">
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
        <form onSubmit={handlePaymentSubmit} className="space-y-4 pt-2">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Payment Method</label>
            <select
              className="w-full h-11 px-3 rounded-lg border border-slate-300 bg-white text-sm"
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
            >
              <option value="upi">UPI (Instant Transfer)</option>
              <option value="card">Credit / Debit Card</option>
              <option value="bank_transfer">Bank Transfer (NEFT/RTGS)</option>
              <option value="cheque">Cheque</option>
              <option value="cash">Cash</option>
            </select>
          </div>

          <Input
            label="Payment Amount"
            type="number"
            step="0.01"
            min="0.01"
            max={balanceDue}
            required
            value={paymentAmount}
            onChange={(e) => setPaymentAmount(e.target.value)}
            helperText={`Max balance due: ${formatCurrency(balanceDue, inv.currency)}`}
          />

          <Input
            label="Payment Date"
            type="date"
            required
            max={new Date().toISOString().split("T")[0]}
            value={paymentDate}
            onChange={(e) => setPaymentDate(e.target.value)}
          />

          <Input
            label="Reference / Transaction Note"
            placeholder="UTR or Cheque number"
            value={paymentNote}
            onChange={(e) => setPaymentNote(e.target.value)}
          />

          <div className="flex justify-end space-x-2 pt-4">
            <Button variant="outline" type="button" onClick={() => setPaymentModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" isLoading={recordPaymentMutation.isPending}>
              Record Settlement
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
