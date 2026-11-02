import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { formatDate } from "@/lib/utils";
import { useToast } from "@/context/ToastContext";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { Dialog } from "@/components/ui/Dialog";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { Plus, ArrowRight, Layers } from "lucide-react";

export function Subscriptions() {
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [templateModalOpen, setTemplateModalOpen] = useState<boolean>(false);

  const queryClient = useQueryClient();
  const toast = useToast();

  const subsQuery = useQuery<{ items: any[]; total: number }>({
    queryKey: ["subscriptions", statusFilter],
    queryFn: () => {
      let url = "/subscriptions?page_size=100";
      if (statusFilter !== "all") url += `&status=${statusFilter}`;
      return api.get(url);
    },
  });

  const templatesQuery = useQuery<{ items: any[] }>({
    queryKey: ["quotation-templates"],
    queryFn: () => api.get("/quotation-templates"),
    enabled: templateModalOpen,
  });

  const customersQuery = useQuery<{ items: any[] }>({
    queryKey: ["customers"],
    queryFn: () => api.get("/customers?page_size=100"),
    enabled: templateModalOpen,
  });

  // Create from template mutation
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | "">("");
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | "">("");
  const [startDate, setStartDate] = useState<string>(new Date().toISOString().split("T")[0]);
  const [expiryDate, setExpiryDate] = useState<string>(
    new Date(Date.now() + 365 * 86400000).toISOString().split("T")[0]
  );

  const createFromTemplateMutation = useMutation({
    mutationFn: (data: any) => api.post<{ id: number }>(`/subscriptions/from-template/${data.templateId}`, data.payload),
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ["subscriptions"] });
      setTemplateModalOpen(false);
      toast.success("Subscription created from template successfully");
      if (res?.id) {
        navigate(`/subscriptions/${res.id}`);
      }
    },
    onError: (err: any) => {
      toast.error(err.message || "Failed to create subscription");
    },
  });

  const handleTemplateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTemplateId || !selectedCustomerId) return;
    createFromTemplateMutation.mutate({
      templateId: selectedTemplateId,
      payload: {
        customer_id: Number(selectedCustomerId),
        start_date: startDate,
        expiry_date: expiryDate,
      },
    });
  };

  const subscriptions = (subsQuery.data?.items || []).filter((s) => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    return (
      s.number.toLowerCase().includes(term) ||
      (s.customer?.name || "").toLowerCase().includes(term) ||
      (s.plan?.name || "").toLowerCase().includes(term)
    );
  });

  const tabs = [
    { key: "all", label: "All" },
    { key: "active", label: "Active" },
    { key: "confirmed", label: "Confirmed" },
    { key: "quotation", label: "Quotation" },
    { key: "paused", label: "Paused" },
    { key: "closed", label: "Closed" },
    { key: "draft", label: "Draft" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Subscriptions</h1>
          <p className="text-sm text-slate-500">Manage client lifecycle, contracts, and recurring tiers</p>
        </div>

        <div className="flex items-center space-x-2">
          <Button variant="outline" size="sm" onClick={() => setTemplateModalOpen(true)}>
            New from Template
          </Button>
          <Link to="/catalog">
            <Button size="sm">
              <Plus className="h-4 w-4 mr-1.5" />
              Configure Plans
            </Button>
          </Link>
        </div>
      </div>

      {/* Filter and Tab Bar */}
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
                placeholder="Search by number, customer..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>

          {/* Subscriptions Table / Mobile Cards */}
          {subsQuery.isLoading ? (
            <div className="py-4">
              <TableSkeleton rows={5} cols={7} />
            </div>
          ) : subscriptions.length === 0 ? (
            <div className="py-4">
              <EmptyState
                icon={Layers}
                title="No subscriptions found"
                description={searchTerm || statusFilter !== "all" ? "No contracts match your active filter or search." : "Get started by generating your first subscription contract."}
                actionLabel="New from Template"
                onAction={() => setTemplateModalOpen(true)}
              />
            </div>
          ) : (
            <>
              {/* Desktop View */}
              <div className="hidden sm:block overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-slate-500 uppercase text-xs border-b border-slate-200">
                    <tr>
                      <th className="px-4 py-3">Number</th>
                      <th className="px-4 py-3">Customer</th>
                      <th className="px-4 py-3">Plan</th>
                      <th className="px-4 py-3">Billing Cycle</th>
                      <th className="px-4 py-3">Next Invoice</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {subscriptions.map((sub) => (
                      <tr key={sub.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-3.5 font-semibold text-indigo-600">
                          <Link to={`/subscriptions/${sub.id}`} className="hover:underline flex items-center">
                            {sub.number}
                          </Link>
                        </td>
                        <td className="px-4 py-3.5 font-medium text-slate-800">
                          {sub.customer?.name || `Customer #${sub.customer_id}`}
                        </td>
                        <td className="px-4 py-3.5 text-slate-600">
                          {sub.plan?.name || `Plan #${sub.plan_id}`}
                        </td>
                        <td className="px-4 py-3.5 text-slate-600 capitalize">
                          {sub.plan?.billing_period || "Monthly"}
                        </td>
                        <td className="px-4 py-3.5 text-slate-600">
                          {formatDate(sub.next_invoice_date)}
                        </td>
                        <td className="px-4 py-3.5">
                          <Badge status={sub.status} />
                        </td>
                        <td className="px-4 py-3.5 text-right">
                          <Link to={`/subscriptions/${sub.id}`}>
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

              {/* Mobile Cards View (<640px) */}
              <div className="sm:hidden divide-y divide-slate-100">
                {subscriptions.map((sub) => (
                  <div key={sub.id} className="py-3.5 space-y-2">
                    <div className="flex justify-between items-start">
                      <div>
                        <Link to={`/subscriptions/${sub.id}`} className="font-semibold text-indigo-600 hover:underline">
                          {sub.number}
                        </Link>
                        <div className="text-xs text-slate-700 font-medium">
                          {sub.customer?.name || `Customer #${sub.customer_id}`}
                        </div>
                      </div>
                      <Badge status={sub.status} />
                    </div>
                    <div className="flex justify-between items-center text-xs text-slate-500 pt-1">
                      <span>{sub.plan?.name || "Standard Plan"} ({sub.plan?.billing_period || "Monthly"})</span>
                      <span>Next: {formatDate(sub.next_invoice_date)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* New From Template Dialog */}
      <Dialog
        open={templateModalOpen}
        onOpenChange={setTemplateModalOpen}
        title="Create Subscription from Template"
        description="Select a template and client to pre-populate product lines and pricing"
      >
        <form onSubmit={handleTemplateSubmit} className="space-y-4 pt-2">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Quotation Template</label>
            <select
              required
              className="w-full h-11 px-3 rounded-lg border border-slate-300 bg-white text-sm"
              value={selectedTemplateId}
              onChange={(e) => setSelectedTemplateId(Number(e.target.value))}
            >
              <option value="">Select a template...</option>
              {templatesQuery.data?.items?.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} (Plan: {t.plan?.name})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Customer</label>
            <select
              required
              className="w-full h-11 px-3 rounded-lg border border-slate-300 bg-white text-sm"
              value={selectedCustomerId}
              onChange={(e) => setSelectedCustomerId(Number(e.target.value))}
            >
              <option value="">Select customer...</option>
              {customersQuery.data?.items?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.company || c.email})
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Start Date"
              type="date"
              required
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
            <Input
              label="Expiry Date"
              type="date"
              required
              value={expiryDate}
              onChange={(e) => setExpiryDate(e.target.value)}
            />
          </div>

          <div className="flex justify-end space-x-2 pt-4">
            <Button variant="outline" type="button" onClick={() => setTemplateModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" isLoading={createFromTemplateMutation.isPending}>
              Generate Contract
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
