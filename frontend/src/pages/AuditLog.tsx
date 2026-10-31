import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import { formatDate } from "@/lib/utils";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/Dialog";
import { Eye, RefreshCw, FileCode } from "lucide-react";

interface AuditLogEntry {
  id: number;
  actor_id?: number;
  action: string;
  entity_type: string;
  entity_id?: number;
  before?: Record<string, any>;
  after?: Record<string, any>;
  request_id?: string;
  at: string;
}

export function AuditLog() {
  const [actionFilter, setActionFilter] = useState("");
  const [entityFilter, setEntityFilter] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(30);

  // Detail Modal state
  const [selectedEntry, setSelectedEntry] = useState<AuditLogEntry | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["audit-log", actionFilter, entityFilter, page, pageSize],
    queryFn: () => {
      const params = new URLSearchParams({
        page: page.toString(),
        page_size: pageSize.toString(),
      });
      if (actionFilter) params.append("action", actionFilter);
      if (entityFilter) params.append("entity_type", entityFilter);

      return api.get<{ items: AuditLogEntry[]; total: number }>(`/audit-log?${params.toString()}`);
    },
  });

  const getActionBadgeColor = (action: string) => {
    if (action.includes("created")) return "bg-emerald-50 text-emerald-700 border-emerald-200";
    if (action.includes("transition") || action.includes("updated"))
      return "bg-indigo-50 text-indigo-700 border-indigo-200";
    if (action.includes("cancelled") || action.includes("failed"))
      return "bg-rose-50 text-rose-700 border-rose-200";
    if (action.includes("billing")) return "bg-amber-50 text-amber-700 border-amber-200";
    return "bg-slate-100 text-slate-700 border-slate-200";
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Audit Log</h1>
          <p className="text-sm text-slate-500 mt-1">
            Immutable, append-only security and financial ledger of every state change and batch run.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Filter Card */}
      <Card className="p-4 bg-white border border-slate-200">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">
              Filter by Action
            </label>
            <Input
              placeholder="e.g. subscription.transition, payment.recorded"
              value={actionFilter}
              onChange={(e) => {
                setActionFilter(e.target.value);
                setPage(1);
              }}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">
              Entity Type
            </label>
            <select
              value={entityFilter}
              onChange={(e) => {
                setEntityFilter(e.target.value);
                setPage(1);
              }}
              className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm bg-white"
            >
              <option value="">All Entities</option>
              <option value="subscription">Subscription</option>
              <option value="invoice">Invoice</option>
              <option value="payment">Payment</option>
              <option value="billing">Billing Run</option>
              <option value="customer">Customer</option>
              <option value="product">Product</option>
            </select>
          </div>

          <div className="flex items-end">
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                setActionFilter("");
                setEntityFilter("");
                setPage(1);
              }}
            >
              Clear Filters
            </Button>
          </div>
        </div>
      </Card>

      {/* Audit Log Table */}
      <Card className="overflow-hidden border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-6 py-3 text-left font-semibold text-slate-600">Timestamp</th>
                <th className="px-6 py-3 text-left font-semibold text-slate-600">Actor</th>
                <th className="px-6 py-3 text-left font-semibold text-slate-600">Action</th>
                <th className="px-6 py-3 text-left font-semibold text-slate-600">Entity</th>
                <th className="px-6 py-3 text-left font-semibold text-slate-600">Request ID</th>
                <th className="px-6 py-3 text-right font-semibold text-slate-600">State Diff</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-slate-400">
                    Loading audit trail...
                  </td>
                </tr>
              ) : !data || data.items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-slate-400">
                    No audit records found.
                  </td>
                </tr>
              ) : (
                data.items.map((entry) => (
                  <tr key={entry.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4 text-xs font-mono text-slate-600 whitespace-nowrap">
                      {formatDate(entry.at)}
                    </td>
                    <td className="px-6 py-4 text-xs font-mono text-slate-700">
                      {entry.actor_id ? `User #${entry.actor_id}` : "System Worker"}
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-medium border ${getActionBadgeColor(
                          entry.action
                        )}`}
                      >
                        {entry.action}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-xs">
                      <span className="font-semibold text-slate-800 capitalize">
                        {entry.entity_type}
                      </span>
                      {entry.entity_id && (
                        <span className="text-slate-400 font-mono ml-1.5">#{entry.entity_id}</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-xs font-mono text-slate-400 max-w-[120px] truncate">
                      {entry.request_id || "N/A"}
                    </td>
                    <td className="px-6 py-4 text-right">
                      {(entry.before || entry.after) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedEntry(entry)}
                        >
                          <Eye className="h-3.5 w-3.5 mr-1" />
                          View Diff
                        </Button>
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
              {Math.min(page * pageSize, data.total)} of {data.total} records
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

      {/* JSON Diff Modal */}
      <Dialog open={!!selectedEntry} onOpenChange={(open) => !open && setSelectedEntry(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center space-x-2">
              <FileCode className="h-5 w-5 text-indigo-600" />
              <span>Audit State Diff #{selectedEntry?.id}</span>
            </DialogTitle>
          </DialogHeader>

          {selectedEntry && (
            <div className="space-y-4 py-2">
              <div className="flex items-center justify-between text-xs text-slate-500 bg-slate-50 p-2 rounded">
                <span>Action: <strong>{selectedEntry.action}</strong></span>
                <span>Entity: <strong>{selectedEntry.entity_type} #{selectedEntry.entity_id}</strong></span>
                <span>Time: <strong>{formatDate(selectedEntry.at)}</strong></span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <h4 className="text-xs font-semibold text-slate-700 uppercase mb-1">
                    Before State
                  </h4>
                  <pre className="p-3 bg-slate-900 text-slate-200 rounded-lg text-xs font-mono overflow-x-auto max-h-60">
                    {selectedEntry.before
                      ? JSON.stringify(selectedEntry.before, null, 2)
                      : "null"}
                  </pre>
                </div>
                <div>
                  <h4 className="text-xs font-semibold text-slate-700 uppercase mb-1">
                    After State
                  </h4>
                  <pre className="p-3 bg-slate-900 text-emerald-400 rounded-lg text-xs font-mono overflow-x-auto max-h-60">
                    {selectedEntry.after
                      ? JSON.stringify(selectedEntry.after, null, 2)
                      : "null"}
                  </pre>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
