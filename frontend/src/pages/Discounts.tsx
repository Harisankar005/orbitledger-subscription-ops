import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { api } from "@/api/client";
import { formatCurrency, formatDate } from "@/lib/utils";
import { useToast } from "@/context/ToastContext";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/Dialog";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { discountSchema, DiscountFormData } from "@/lib/schemas";
import { handleServerErrors } from "@/lib/form-errors";
import { Tag, Plus, CheckCircle2, Clock, AlertTriangle, XCircle, Power } from "lucide-react";

interface DiscountRule {
  id: number;
  name: string;
  kind: "fixed" | "percent";
  value: number;
  min_purchase_amount?: number;
  min_quantity?: number;
  start_date?: string;
  end_date?: string;
  usage_limit?: number;
  used_count: number;
  scope: "product" | "subscription";
  product_id?: number;
  target_subscription_id?: number;
  is_active: boolean;
}

export function Discounts() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [scopeFilter, setScopeFilter] = useState<string>("");
  const [isModalOpen, setIsModalOpen] = useState(false);

  const todayStr = new Date().toISOString().split("T")[0];
  const nextYearStr = new Date(Date.now() + 365 * 86400000).toISOString().split("T")[0];

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<DiscountFormData>({
    resolver: zodResolver(discountSchema),
    defaultValues: {
      name: "",
      scope: "subscription",
      kind: "percent",
      value: 10,
      min_purchase_amount: 0,
      min_quantity: 1,
      start_date: todayStr,
      end_date: nextYearStr,
      usage_limit: null,
      product_id: null,
      is_active: true,
    },
  });

  const selectedScope = watch("scope");
  const selectedKind = watch("kind");

  const { data: productsData } = useQuery({
    queryKey: ["catalog-products"],
    queryFn: () => api.get<{ items: any[] }>("/products"),
  });

  const { data, isLoading } = useQuery({
    queryKey: ["discounts", scopeFilter],
    queryFn: () => {
      const url = scopeFilter ? `/discounts?scope=${scopeFilter}` : "/discounts";
      return api.get<{ items: DiscountRule[]; total: number }>(url);
    },
  });

  const createRuleMutation = useMutation({
    mutationFn: (formData: DiscountFormData) =>
      api.post("/discounts", {
        name: formData.name,
        scope: formData.scope,
        kind: formData.kind,
        value: formData.value,
        min_purchase_amount: formData.min_purchase_amount || 0,
        min_quantity: formData.min_quantity || 1,
        usage_limit: formData.usage_limit || undefined,
        start_date: formData.start_date,
        end_date: formData.end_date,
        product_id: formData.scope === "product" && formData.product_id ? formData.product_id : undefined,
        is_active: true,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["discounts"] });
      toast.success("Discount rule created successfully!");
      setIsModalOpen(false);
      reset();
    },
    onError: (err: any) => handleServerErrors(err, setError, toast, "Failed to create discount rule"),
  });

  const toggleMutation = useMutation({
    mutationFn: (id: number) => api.post(`/discounts/${id}/toggle`),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["discounts"] });
      toast.success(`Discount rule is now ${data.is_active ? "active" : "inactive"}`);
    },
    onError: (err: any) => {
      toast.error(err.message || "Failed to toggle discount rule");
    },
  });

  const getStatusBadge = (rule: DiscountRule) => {
    const today = new Date().toISOString().split("T")[0];
    if (!rule.is_active) {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-600">
          Disabled
        </span>
      );
    }
    if (rule.usage_limit && rule.used_count >= rule.usage_limit) {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-rose-50 text-rose-700 border border-rose-200">
          <XCircle className="h-3 w-3 mr-1" />
          Exhausted
        </span>
      );
    }
    if (rule.end_date && rule.end_date < today) {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
          <AlertTriangle className="h-3 w-3 mr-1" />
          Expired
        </span>
      );
    }
    if (rule.start_date && rule.start_date > today) {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
          <Clock className="h-3 w-3 mr-1" />
          Scheduled
        </span>
      );
    }
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
        <CheckCircle2 className="h-3 w-3 mr-1" />
        Active
      </span>
    );
  };

  const openModal = () => {
    reset({
      name: "",
      scope: "subscription",
      kind: "percent",
      value: 10,
      min_purchase_amount: 0,
      min_quantity: 1,
      start_date: todayStr,
      end_date: nextYearStr,
      usage_limit: null,
      product_id: null,
      is_active: true,
    });
    setIsModalOpen(true);
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Discounts & Promotions</h1>
          <p className="text-sm text-slate-500 mt-1">
            Configure order-level and line-item discounts with automatic single-best resolution.
          </p>
        </div>
        <Button size="sm" onClick={openModal}>
          <Plus className="h-4 w-4 mr-1.5" />
          Create Discount Rule
        </Button>
      </div>

      {/* Filter Tabs */}
      <div className="flex space-x-2 border-b border-slate-200">
        <button
          onClick={() => setScopeFilter("")}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            scopeFilter === ""
              ? "border-indigo-600 text-indigo-600 font-semibold"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          All Rules
        </button>
        <button
          onClick={() => setScopeFilter("subscription")}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            scopeFilter === "subscription"
              ? "border-indigo-600 text-indigo-600 font-semibold"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          Subscription-Scoped
        </button>
        <button
          onClick={() => setScopeFilter("product")}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            scopeFilter === "product"
              ? "border-indigo-600 text-indigo-600 font-semibold"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          Product-Scoped
        </button>
      </div>

      {/* Rules Table */}
      <Card className="overflow-hidden border border-slate-200 bg-white">
        {isLoading ? (
          <div className="p-6">
            <TableSkeleton rows={4} cols={7} />
          </div>
        ) : !data || data.items.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={Tag}
              title="No discount rules found"
              description="Create a promotional campaign to provide volume, partner, or seasonal discounts."
              actionLabel="Create Discount Rule"
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
                    <th className="px-6 py-3 text-left font-semibold text-slate-600">Rule Name</th>
                    <th className="px-6 py-3 text-left font-semibold text-slate-600">Scope</th>
                    <th className="px-6 py-3 text-left font-semibold text-slate-600">Deduction</th>
                    <th className="px-6 py-3 text-left font-semibold text-slate-600">Conditions</th>
                    <th className="px-6 py-3 text-left font-semibold text-slate-600">Usage</th>
                    <th className="px-6 py-3 text-left font-semibold text-slate-600">Status</th>
                    <th className="px-6 py-3 text-right font-semibold text-slate-600">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {data.items.map((rule) => (
                    <tr key={rule.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-4 font-semibold text-slate-900">{rule.name}</td>
                      <td className="px-6 py-4">
                        <span className="capitalize px-2 py-0.5 rounded text-xs font-mono bg-slate-100 text-slate-700">
                          {rule.scope}
                        </span>
                      </td>
                      <td className="px-6 py-4 font-bold text-indigo-700">
                        {rule.kind === "percent" ? `${rule.value}% OFF` : `-${formatCurrency(rule.value)}`}
                      </td>
                      <td className="px-6 py-4 text-xs text-slate-600">
                        {rule.min_purchase_amount ? (
                          <div>Min Subtotal: {formatCurrency(rule.min_purchase_amount)}</div>
                        ) : null}
                        {rule.min_quantity && rule.min_quantity > 1 ? (
                          <div>Min Qty: {rule.min_quantity}</div>
                        ) : null}
                        {rule.start_date || rule.end_date ? (
                          <div className="text-slate-400">
                            {rule.start_date ? formatDate(rule.start_date) : "Any"} to{" "}
                            {rule.end_date ? formatDate(rule.end_date) : "Any"}
                          </div>
                        ) : (
                          <div className="text-slate-400">No time constraint</div>
                        )}
                      </td>
                      <td className="px-6 py-4 text-xs font-mono">
                        <span className="font-semibold text-slate-800">{rule.used_count}</span>
                        <span className="text-slate-400">
                          {" "}
                          / {rule.usage_limit ? rule.usage_limit : "∞"}
                        </span>
                      </td>
                      <td className="px-6 py-4">{getStatusBadge(rule)}</td>
                      <td className="px-6 py-4 text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => toggleMutation.mutate(rule.id)}
                          disabled={toggleMutation.isPending}
                          title={rule.is_active ? "Deactivate rule" : "Activate rule"}
                        >
                          <Power className={`h-3.5 w-3.5 mr-1 ${rule.is_active ? "text-emerald-600" : "text-slate-400"}`} />
                          {rule.is_active ? "Active" : "Disabled"}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Stacked Cards (<640px) */}
            <div className="sm:hidden divide-y divide-slate-100">
              {data.items.map((rule) => (
                <div key={rule.id} className="p-4 space-y-2">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="font-semibold text-slate-900">{rule.name}</div>
                      <div className="text-xs text-indigo-700 font-bold">
                        {rule.kind === "percent" ? `${rule.value}% OFF` : `-${formatCurrency(rule.value)}`} ({rule.scope})
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => toggleMutation.mutate(rule.id)}
                      disabled={toggleMutation.isPending}
                    >
                      <Power className={`h-3.5 w-3.5 mr-1 ${rule.is_active ? "text-emerald-600" : "text-slate-400"}`} />
                      {rule.is_active ? "Active" : "Disabled"}
                    </Button>
                  </div>
                  <div className="flex justify-between items-center text-xs text-slate-500 pt-1">
                    <div>Used: {rule.used_count} / {rule.usage_limit || "∞"}</div>
                    <div>{getStatusBadge(rule)}</div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </Card>

      {/* Create Rule Modal */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Discount Rule</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={handleSubmit((data) => createRuleMutation.mutate(data))}
            className="space-y-4 py-2"
            noValidate
          >
            <Input
              label="Rule Name"
              required
              placeholder="e.g. Early Bird 10%, Volume Partner 500"
              error={errors.name?.message}
              {...register("name")}
            />

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Scope *</label>
                <select
                  {...register("scope")}
                  className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm bg-white"
                >
                  <option value="subscription">Subscription (Order-level)</option>
                  <option value="product">Product (Line-item)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Discount Type *</label>
                <select
                  {...register("kind")}
                  className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm bg-white"
                >
                  <option value="percent">Percentage (%)</option>
                  <option value="fixed">Fixed Amount (INR)</option>
                </select>
              </div>
            </div>

            {selectedScope === "product" && (
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Target Product *</label>
                <select
                  {...register("product_id", { valueAsNumber: true })}
                  className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm bg-white"
                >
                  <option value="">Select a product...</option>
                  {productsData?.items?.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                {errors.product_id?.message && (
                  <p className="mt-1 text-xs text-rose-600">{errors.product_id.message}</p>
                )}
              </div>
            )}

            <Input
              label={`Discount Value (${selectedKind === "percent" ? "%" : "INR"})`}
              type="number"
              step="0.01"
              required
              placeholder={selectedKind === "percent" ? "10" : "500"}
              error={errors.value?.message}
              {...register("value", { valueAsNumber: true })}
            />

            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Min Purchase (INR)"
                type="number"
                step="0.01"
                placeholder="0.00"
                error={errors.min_purchase_amount?.message}
                {...register("min_purchase_amount", { valueAsNumber: true })}
              />

              <Input
                label="Min Quantity"
                type="number"
                min="1"
                placeholder="1"
                error={errors.min_quantity?.message}
                {...register("min_quantity", { valueAsNumber: true })}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Start Date"
                type="date"
                required
                error={errors.start_date?.message}
                {...register("start_date")}
              />

              <Input
                label="End Date"
                type="date"
                required
                error={errors.end_date?.message}
                {...register("end_date")}
              />
            </div>

            <Input
              label="Max Usage Limit (Optional)"
              type="number"
              min="1"
              placeholder="Leave blank for unlimited"
              error={errors.usage_limit?.message}
              {...register("usage_limit", {
                setValueAs: (v) => (v === "" || v === undefined ? null : Number(v)),
              })}
            />

            <DialogFooter>
              <Button variant="outline" type="button" onClick={() => setIsModalOpen(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                isLoading={createRuleMutation.isPending || isSubmitting}
                disabled={createRuleMutation.isPending || isSubmitting}
              >
                Save Discount Rule
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
