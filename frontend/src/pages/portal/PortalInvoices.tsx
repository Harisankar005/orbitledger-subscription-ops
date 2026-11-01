import React from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Printer, AlertCircle } from "lucide-react";

interface PortalInvoice {
  id: number;
  number: string;
  subscription_id: number;
  period_start: string;
  period_end: string;
  issue_date: string;
  due_date: string;
  status: "draft" | "confirmed" | "cancelled";
  subtotal: number;
  discount_total: number;
  tax_total: number;
  total: number;
  amount_paid: number;
  currency: string;
  payment_status: "paid" | "partial" | "unpaid" | "overdue";
}

export function PortalInvoices() {
  const { data, isLoading } = useQuery({
    queryKey: ["portal-invoices"],
    queryFn: () =>
      api.get<{
        items: PortalInvoice[];
        total: number;
        total_outstanding: number;
      }>("/portal/invoices"),
  });

  const getPaymentStatusBadge = (status: string) => {
    switch (status) {
      case "paid":
        return <Badge variant="success">Paid</Badge>;
      case "partial":
        return <Badge variant="warning">Partially Paid</Badge>;
      case "overdue":
        return <Badge variant="destructive">Overdue</Badge>;
      default:
        return <Badge variant="info">Unpaid</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">My Invoices</h1>
        <p className="text-sm text-slate-500 mt-1">
          Review billed subscription cycles, payment status, and download tax invoices.
        </p>
      </div>

      {/* Outstanding Banner */}
      {data && data.total_outstanding > 0 && (
        <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <AlertCircle className="h-5 w-5 text-amber-600" />
            <div>
              <div className="text-sm font-semibold text-amber-900">
                Outstanding Balance Due: {formatCurrency(data.total_outstanding)}
              </div>
              <div className="text-xs text-amber-700">
                Please arrange payment via bank transfer or online gateway to keep services active.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Invoices Table & Mobile Cards */}
      <Card className="overflow-hidden border border-slate-200 bg-white">
        {isLoading ? (
          <div className="px-6 py-12 text-center text-slate-400">Loading invoices...</div>
        ) : !data || data.items.length === 0 ? (
          <div className="px-6 py-12 text-center text-slate-400">No invoices generated yet.</div>
        ) : (
          <>
            {/* Desktop Table */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-6 py-3 text-left font-semibold text-slate-600">Invoice</th>
                    <th className="px-6 py-3 text-left font-semibold text-slate-600">Period</th>
                    <th className="px-6 py-3 text-left font-semibold text-slate-600">Due Date</th>
                    <th className="px-6 py-3 text-right font-semibold text-slate-600">Total</th>
                    <th className="px-6 py-3 text-right font-semibold text-slate-600">Paid</th>
                    <th className="px-6 py-3 text-left font-semibold text-slate-600">Status</th>
                    <th className="px-6 py-3 text-right font-semibold text-slate-600">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {data.items.map((inv) => (
                    <tr key={inv.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-4 font-mono font-semibold text-slate-900">{inv.number}</td>
                      <td className="px-6 py-4 text-xs text-slate-600">
                        {formatDate(inv.period_start)} to {formatDate(inv.period_end)}
                      </td>
                      <td className="px-6 py-4 text-xs text-slate-700 font-medium">{formatDate(inv.due_date)}</td>
                      <td className="px-6 py-4 text-right font-semibold text-slate-900">
                        {formatCurrency(inv.total, inv.currency)}
                      </td>
                      <td className="px-6 py-4 text-right text-xs text-slate-600 font-mono">
                        {formatCurrency(inv.amount_paid, inv.currency)}
                      </td>
                      <td className="px-6 py-4">{getPaymentStatusBadge(inv.payment_status)}</td>
                      <td className="px-6 py-4 text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => window.open(`/api/portal/invoices/${inv.id}/print`, "_blank")}
                        >
                          <Printer className="h-3.5 w-3.5 mr-1" />
                          Print
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Cards (<640px) */}
            <div className="sm:hidden divide-y divide-slate-100 p-4 space-y-3">
              {data.items.map((inv) => (
                <div key={inv.id} className="pt-3 first:pt-0 space-y-2">
                  <div className="flex justify-between items-start">
                    <div>
                      <span className="font-mono font-bold text-slate-900 text-sm">{inv.number}</span>
                      <div className="text-xs text-slate-500">
                        {formatDate(inv.period_start)} - {formatDate(inv.period_end)}
                      </div>
                    </div>
                    {getPaymentStatusBadge(inv.payment_status)}
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-500">Due: {formatDate(inv.due_date)}</span>
                    <span className="font-bold text-slate-900 text-sm">
                      {formatCurrency(inv.total, inv.currency)}
                    </span>
                  </div>
                  <div className="flex justify-end pt-1">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => window.open(`/api/portal/invoices/${inv.id}/print`, "_blank")}
                    >
                      <Printer className="h-3.5 w-3.5 mr-1" /> Print PDF
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
