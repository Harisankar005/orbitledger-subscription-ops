import React, { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { Dialog } from "@/components/ui/Dialog";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { useToast } from "@/context/ToastContext";
import { Check, Mail, Printer, ArrowRight, CheckSquare, Square, FileText } from "lucide-react";

export function Invoices() {
  const toast = useToast();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [bulkResultModal, setBulkResultModal] = useState<any | null>(null);

  const queryClient = useQueryClient();

  const invoicesQuery = useQuery<{ items: any[]; total: number }>({
    queryKey: ["invoices", statusFilter],
    queryFn: () => {
      let url = "/invoices?page_size=100";
      if (statusFilter !== "all") url += `&payment_status=${statusFilter}`;
      return api.get(url);
    },
  });

  const bulkMutation = useMutation({
    mutationFn: (data: { invoice_ids: number[]; action: "confirm" | "send" }) =>
      api.post("/invoices/bulk", data),
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      setSelectedIds([]);
      setBulkResultModal(res);
      toast.success(`Bulk action completed: ${res.succeeded} succeeded, ${res.failed} failed`);
    },
    onError: (err: any) => {
      toast.error(err.message || "Bulk Action Failed");
    },
  });

  const toggleSelectAll = () => {
    if (selectedIds.length === filteredInvoices.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredInvoices.map((inv) => inv.id));
    }
  };

  const toggleSelectOne = (id: number) => {
    if (selectedIds.includes(id)) {
      setSelectedIds(selectedIds.filter((item) => item !== id));
    } else {
      setSelectedIds([...selectedIds, id]);
    }
  };

  const filteredInvoices = (invoicesQuery.data?.items || []).filter((inv) => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      inv.number.toLowerCase().includes(term) ||
      (inv.customer?.name || "").toLowerCase().includes(term)
    );
  });

  const tabs = [
    { key: "all", label: "All" },
    { key: "confirmed", label: "Confirmed" },
    { key: "paid", label: "Paid" },
    { key: "partially paid", label: "Partially Paid" },
    { key: "overdue", label: "Overdue" },
    { key: "draft", label: "Draft" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Invoices</h1>
          <p className="text-sm text-slate-500">Track receivables, print legal invoices, and monitor collection statuses</p>
        </div>

        {/* Bulk Action Controls */}
        {selectedIds.length > 0 && (
          <div className="flex items-center space-x-2 bg-indigo-50 border border-indigo-200 px-3 py-1.5 rounded-lg">
            <span className="text-xs font-semibold text-indigo-900 mr-2">
              {selectedIds.length} Selected
            </span>
            <Button
              size="sm"
              variant="outline"
              className="bg-white"
              onClick={() => bulkMutation.mutate({ invoice_ids: selectedIds, action: "confirm" })}
              isLoading={bulkMutation.isPending}
            >
              <Check className="h-3.5 w-3.5 mr-1 text-emerald-600" /> Bulk Confirm
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="bg-white"
              onClick={() => bulkMutation.mutate({ invoice_ids: selectedIds, action: "send" })}
              isLoading={bulkMutation.isPending}
            >
              <Mail className="h-3.5 w-3.5 mr-1 text-blue-600" /> Bulk Send
            </Button>
          </div>
        )}
      </div>

      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="flex flex-col sm:flex-row gap-4 justify-between items-center">
            {/* Status Tabs */}
            <div className="flex flex-wrap gap-1 w-full sm:w-auto">
              {tabs.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setStatusFilter(tab.key)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                    statusFilter === tab.key
                      ? "bg-indigo-600 text-white font-semibold shadow-sm"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Search Box */}
            <div className="w-full sm:w-64">
              <Input
                placeholder="Search invoice number, client..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>

          {/* Invoices List / Table */}
          {invoicesQuery.isLoading ? (
            <div className="py-4">
              <TableSkeleton rows={6} cols={9} />
            </div>
          ) : filteredInvoices.length === 0 ? (
            <div className="py-4">
              <EmptyState
                icon={FileText}
                title="No invoices found"
                description={
                  searchTerm || statusFilter !== "all"
                    ? "No invoices match your active filter or search."
                    : "Invoices generated from billing runs or subscriptions will show up here."
                }
              />
            </div>
          ) : (
            <>
              {/* Desktop Table View */}
              <div className="hidden sm:block overflow-x-auto" role="region" tabIndex={0} aria-label="Invoices list table">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-slate-500 uppercase text-xs border-b border-slate-200">
                    <tr>
                      <th className="px-4 py-3 w-10">
                        <button onClick={toggleSelectAll} className="cursor-pointer" aria-label="Select all invoices">
                          {selectedIds.length > 0 && selectedIds.length === filteredInvoices.length ? (
                            <CheckSquare className="h-4 w-4 text-indigo-600" />
                          ) : (
                            <Square className="h-4 w-4 text-slate-400" />
                          )}
                        </button>
                      </th>
                      <th className="px-4 py-3">Number</th>
                      <th className="px-4 py-3">Customer</th>
                      <th className="px-4 py-3">Issue Date</th>
                      <th className="px-4 py-3">Due Date</th>
                      <th className="px-4 py-3 text-right">Total Amount</th>
                      <th className="px-4 py-3 text-right">Amount Paid</th>
                      <th className="px-4 py-3 text-center">Status</th>
                      <th className="px-4 py-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredInvoices.map((inv) => (
                      <tr key={inv.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-3.5">
                          <button onClick={() => toggleSelectOne(inv.id)} className="cursor-pointer" aria-label={`Select invoice ${inv.number}`}>
                            {selectedIds.includes(inv.id) ? (
                              <CheckSquare className="h-4 w-4 text-indigo-600" />
                            ) : (
                              <Square className="h-4 w-4 text-slate-400" />
                            )}
                          </button>
                        </td>
                        <td className="px-4 py-3.5 font-semibold text-indigo-600">
                          <Link to={`/invoices/${inv.id}`} className="hover:underline">
                            {inv.number}
                          </Link>
                        </td>
                        <td className="px-4 py-3.5 font-medium text-slate-800">
                          {inv.customer?.name || `Customer #${inv.customer_id}`}
                        </td>
                        <td className="px-4 py-3.5 text-slate-600">{formatDate(inv.issue_date)}</td>
                        <td className="px-4 py-3.5 text-slate-600">{formatDate(inv.due_date)}</td>
                        <td className="px-4 py-3.5 text-right font-bold text-slate-900">
                          {formatCurrency(inv.total, inv.currency)}
                        </td>
                        <td className="px-4 py-3.5 text-right text-emerald-700 font-semibold">
                          {formatCurrency(inv.amount_paid, inv.currency)}
                        </td>
                        <td className="px-4 py-3.5 text-center">
                          <Badge status={inv.payment_status || inv.status} />
                        </td>
                        <td className="px-4 py-3.5 text-right space-x-1">
                          <a
                            href={`/api/invoices/${inv.id}/print`}
                            target="_blank"
                            rel="noreferrer"
                            title="Print PDF"
                            aria-label={`Print invoice ${inv.number}`}
                          >
                            <Button variant="ghost" size="sm">
                              <Printer className="h-3.5 w-3.5" />
                            </Button>
                          </a>
                          <Link to={`/invoices/${inv.id}`} aria-label={`View invoice ${inv.number}`}>
                            <Button variant="ghost" size="sm">
                              View <ArrowRight className="h-3.5 w-3.5 ml-1" />
                            </Button>
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile Card View */}
              <div className="sm:hidden space-y-3">
                {filteredInvoices.map((inv) => (
                  <div key={inv.id} className="p-4 bg-white border border-slate-200 rounded-xl shadow-xs space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <button onClick={() => toggleSelectOne(inv.id)} className="cursor-pointer" aria-label={`Select invoice ${inv.number}`}>
                          {selectedIds.includes(inv.id) ? (
                            <CheckSquare className="h-4 w-4 text-indigo-600" />
                          ) : (
                            <Square className="h-4 w-4 text-slate-400" />
                          )}
                        </button>
                        <div>
                          <Link to={`/invoices/${inv.id}`} className="font-semibold text-indigo-600 hover:underline">
                            {inv.number}
                          </Link>
                          <p className="text-xs text-slate-500 font-medium">
                            {inv.customer?.name || `Customer #${inv.customer_id}`}
                          </p>
                        </div>
                      </div>
                      <Badge status={inv.payment_status || inv.status} />
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs text-slate-600 pt-1 border-t border-slate-100">
                      <div>
                        <span className="text-slate-400 block">Due Date</span>
                        <span>{formatDate(inv.due_date)}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block">Total / Paid</span>
                        <span className="font-bold text-slate-900">{formatCurrency(inv.total, inv.currency)}</span>
                        <span className="text-emerald-700 block text-[11px] font-medium">
                          Paid: {formatCurrency(inv.amount_paid, inv.currency)}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                      <a
                        href={`/api/invoices/${inv.id}/print`}
                        target="_blank"
                        rel="noreferrer"
                        title="Print PDF"
                        aria-label={`Print invoice ${inv.number}`}
                      >
                        <Button variant="outline" size="sm">
                          <Printer className="h-3.5 w-3.5 mr-1" /> Print
                        </Button>
                      </a>
                      <Link to={`/invoices/${inv.id}`} className="flex-1" aria-label={`View invoice ${inv.number}`}>
                        <Button variant="ghost" size="sm" className="w-full">
                          View Details <ArrowRight className="h-3.5 w-3.5 ml-1" />
                        </Button>
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Bulk Result Dialog */}
      <Dialog
        open={!!bulkResultModal}
        onOpenChange={() => setBulkResultModal(null)}
        title="Bulk Action Completed"
      >
        {bulkResultModal && (
          <div className="space-y-4 pt-2">
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                <div className="font-bold text-lg text-slate-900">{bulkResultModal.total_processed}</div>
                <div className="text-slate-500">Processed</div>
              </div>
              <div className="p-3 bg-emerald-50 rounded-lg border border-emerald-200">
                <div className="font-bold text-lg text-emerald-700">{bulkResultModal.succeeded}</div>
                <div className="text-emerald-600">Succeeded</div>
              </div>
              <div className="p-3 bg-rose-50 rounded-lg border border-rose-200">
                <div className="font-bold text-lg text-rose-700">{bulkResultModal.failed}</div>
                <div className="text-rose-600">Failed</div>
              </div>
            </div>

            <div className="max-h-60 overflow-y-auto space-y-1 text-xs">
              {bulkResultModal.results?.map((r: any) => (
                <div
                  key={r.id}
                  className={`p-2 rounded flex justify-between ${
                    r.success ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"
                  }`}
                >
                  <span>Invoice #{r.id}</span>
                  <span>{r.success ? r.status : r.error}</span>
                </div>
              ))}
            </div>

            <div className="flex justify-end pt-2">
              <Button onClick={() => setBulkResultModal(null)}>Close</Button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
