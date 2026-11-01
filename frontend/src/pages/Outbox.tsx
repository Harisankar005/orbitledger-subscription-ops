import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { formatDate } from "@/lib/utils";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/Dialog";
import { Mail, RefreshCw, ExternalLink, AlertTriangle, CheckCircle, Clock, Eye } from "lucide-react";

interface OutboxItem {
  id: number;
  to_email: string;
  subject: string;
  body_html: string;
  kind: string;
  status: "pending" | "sent" | "failed";
  attempts: number;
  last_error?: string;
  created_at: string;
  sent_at?: string;
  dedupe_key?: string;
}

export function Outbox() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(25);
  const [previewItem, setPreviewItem] = useState<OutboxItem | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["outbox", statusFilter, page, pageSize],
    queryFn: () => {
      const params = new URLSearchParams({
        page: page.toString(),
        page_size: pageSize.toString(),
      });
      if (statusFilter) params.append("status", statusFilter);

      return api.get<{ items: OutboxItem[]; total: number }>(`/outbox?${params.toString()}`);
    },
  });

  const retryMutation = useMutation({
    mutationFn: (id: number) => api.post(`/outbox/${id}/retry`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["outbox"] });
    },
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "sent":
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
            <CheckCircle className="h-3 w-3 mr-1" />
            Sent
          </span>
        );
      case "failed":
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-rose-50 text-rose-700 border border-rose-200">
            <AlertTriangle className="h-3 w-3 mr-1" />
            Failed
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
            <Clock className="h-3 w-3 mr-1" />
            Pending
          </span>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Outbox Queue</h1>
          <p className="text-sm text-slate-500 mt-1">
            Transactional email dispatcher with deduplication and Mailpit local inbox delivery.
          </p>
        </div>
        <div className="flex items-center space-x-3">
          <a
            href="http://localhost:8025"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center px-3 py-1.5 rounded-lg border border-indigo-200 bg-indigo-50 text-xs font-medium text-indigo-700 hover:bg-indigo-100 transition-colors"
          >
            <Mail className="h-3.5 w-3.5 mr-1.5" />
            Open Mailpit Inbox (:8025)
            <ExternalLink className="h-3 w-3 ml-1" />
          </a>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center space-x-2">
        <Button
          variant={statusFilter === "" ? "primary" : "outline"}
          size="sm"
          onClick={() => {
            setStatusFilter("");
            setPage(1);
          }}
        >
          All Messages
        </Button>
        <Button
          variant={statusFilter === "pending" ? "primary" : "outline"}
          size="sm"
          onClick={() => {
            setStatusFilter("pending");
            setPage(1);
          }}
        >
          Pending
        </Button>
        <Button
          variant={statusFilter === "sent" ? "primary" : "outline"}
          size="sm"
          onClick={() => {
            setStatusFilter("sent");
            setPage(1);
          }}
        >
          Sent
        </Button>
        <Button
          variant={statusFilter === "failed" ? "primary" : "outline"}
          size="sm"
          onClick={() => {
            setStatusFilter("failed");
            setPage(1);
          }}
        >
          Failed
        </Button>
      </div>

      {/* Outbox Table & Mobile Cards */}
      <Card className="overflow-hidden border border-slate-200 bg-white">
        {isLoading ? (
          <div className="px-6 py-12 text-center text-slate-400">Loading outbox messages...</div>
        ) : !data || data.items.length === 0 ? (
          <div className="px-6 py-12 text-center text-slate-400">No emails in queue.</div>
        ) : (
          <>
            <div className="hidden sm:block overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-6 py-3 text-left font-semibold text-slate-600">Recipient</th>
                    <th className="px-6 py-3 text-left font-semibold text-slate-600">Subject</th>
                    <th className="px-6 py-3 text-left font-semibold text-slate-600">Kind</th>
                    <th className="px-6 py-3 text-left font-semibold text-slate-600">Status</th>
                    <th className="px-6 py-3 text-left font-semibold text-slate-600">Created / Sent</th>
                    <th className="px-6 py-3 text-right font-semibold text-slate-600">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {data.items.map((msg) => (
                    <tr key={msg.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-4 font-mono text-xs text-slate-800">{msg.to_email}</td>
                      <td className="px-6 py-4">
                        <div className="font-semibold text-slate-900">{msg.subject}</div>
                        {msg.last_error && (
                          <div className="text-xs text-rose-600 mt-1 font-mono">
                            Error: {msg.last_error}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <span className="capitalize px-2 py-0.5 rounded text-xs font-mono bg-slate-100 text-slate-700">
                          {msg.kind.replace("_", " ")}
                        </span>
                      </td>
                      <td className="px-6 py-4">{getStatusBadge(msg.status)}</td>
                      <td className="px-6 py-4 text-xs text-slate-500">
                        <div>Created: {formatDate(msg.created_at)}</div>
                        {msg.sent_at && (
                          <div className="text-emerald-600 font-medium">
                            Sent: {formatDate(msg.sent_at)}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end space-x-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setPreviewItem(msg)}
                          >
                            <Eye className="h-3.5 w-3.5 mr-1" />
                            View
                          </Button>
                          {msg.status !== "sent" && (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={retryMutation.isPending}
                              onClick={() => retryMutation.mutate(msg.id)}
                            >
                              Retry
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Cards View (<640px) */}
            <div className="sm:hidden divide-y divide-slate-100 p-4 space-y-3">
              {data.items.map((msg) => (
                <div key={msg.id} className="pt-3 first:pt-0 space-y-2">
                  <div className="flex justify-between items-start">
                    <span className="font-mono text-xs font-semibold text-slate-800">{msg.to_email}</span>
                    {getStatusBadge(msg.status)}
                  </div>
                  <div className="font-semibold text-slate-900 text-sm">{msg.subject}</div>
                  <div className="text-xs text-slate-500">
                    Created: {formatDate(msg.created_at)}
                  </div>
                  <div className="flex justify-end space-x-2 pt-1">
                    <Button variant="ghost" size="sm" onClick={() => setPreviewItem(msg)}>
                      <Eye className="h-3.5 w-3.5 mr-1" /> View
                    </Button>
                    {msg.status !== "sent" && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={retryMutation.isPending}
                        onClick={() => retryMutation.mutate(msg.id)}
                      >
                        Retry
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </Card>

      {/* Email Body Preview Modal */}
      <Dialog open={!!previewItem} onOpenChange={(open) => !open && setPreviewItem(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Email Preview: {previewItem?.subject}</DialogTitle>
          </DialogHeader>

          {previewItem && (
            <div className="space-y-4 py-2">
              <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-xs space-y-1">
                <div>
                  <span className="font-semibold text-slate-700">To:</span> {previewItem.to_email}
                </div>
                <div>
                  <span className="font-semibold text-slate-700">Subject:</span> {previewItem.subject}
                </div>
                <div>
                  <span className="font-semibold text-slate-700">Kind:</span> {previewItem.kind}
                </div>
              </div>

              <div className="border border-slate-200 rounded-lg p-4 bg-white min-h-[200px]">
                <div
                  dangerouslySetInnerHTML={{ __html: previewItem.body_html }}
                  className="prose prose-sm max-w-none"
                />
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
