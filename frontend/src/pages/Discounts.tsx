import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/Dialog";
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
  const [scopeFilter, setScopeFilter] = useState<string>("");
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Form state
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"product" | "subscription">("subscription");
  const [kind, setKind] = useState<"percent" | "fixed">("percent");
  const [value, setValue] = useState("");
  const [minPurchase, setMinPurchase] = useState("0");
  const [minQuantity, setMinQuantity] = useState("1");
  const [usageLimit, setUsageLimit] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [productId, setProductId] = useState("");

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
    mutationFn: () =>
      api.post("/discounts", {
        name,
        scope,
        kind,
        value: parseFloat(value),
        min_purchase_amount: parseFloat(minPurchase) || 0,
        min_quantity: parseInt(minQuantity, 10) || 1,
        usage_limit: usageLimit ? parseInt(usageLimit, 10) : undefined,
        start_date: startDate || undefined,
        end_date: endDate || undefined,
        product_id: scope === "product" && productId ? parseInt(productId, 10) : undefined,
        is_active: true,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["discounts"] });
      setIsModalOpen(false);
      setName("");
      setValue("");
    },
  });

  const toggleMutation = useMutation({
    mutationFn: (id: number) => api.post(`/discounts/${id}/toggle`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["discounts"] });
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
    if (rule.start_date && rule.start_date > today) {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
          <Clock className="h-3 w-3 mr-1" />
          Scheduled
        </span>
      );
    }
    if (rule.end_date && rule.end_date < today) {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700">
          Expired
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

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Discount Rules</h1>
          <p className="text-sm text-slate-500 mt-1">
            Product line promotions, order-level subscription discounts, and atomic usage caps.
          </p>
        </div>
        <Button size="sm" onClick={() => setIsModalOpen(true)}>
          <Plus className="h-4 w-4 mr-1.5" />
          Create Discount Rule
        </Button>
      </div>

      {/* Scope Filter Bar */}
      <div className="flex items-center space-x-2">
        <Button
          variant={scopeFilter === "" ? "primary" : "outline"}
          size="sm"
          onClick={() => setScopeFilter("")}
        >
          All Scopes
        </Button>
        <Button
          variant={scopeFilter === "subscription" ? "primary" : "outline"}
          size="sm"
          onClick={() => setScopeFilter("subscription")}
        >
          Subscription-Level
        </Button>
        <Button
          variant={scopeFilter === "product" ? "primary" : "outline"}
          size="sm"
          onClick={() => setScopeFilter("product")}
        >
          Product-Line Level
        </Button>
      </div>

      {/* Discounts Table */}
      <Card className="overflow-hidden border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-6 py-3 text-left font-semibold text-slate-600">Rule Name</th>
                <th className="px-6 py-3 text-left font-semibold text-slate-600">Scope</th>
                <th className="px-6 py-3 text-left font-semibold text-slate-600">Discount</th>
                <th className="px-6 py-3 text-left font-semibold text-slate-600">Conditions</th>
                <th className="px-6 py-3 text-left font-semibold text-slate-600">Usage</th>
                <th className="px-6 py-3 text-left font-semibold text-slate-600">Status</th>
                <th className="px-6 py-3 text-right font-semibold text-slate-600">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-slate-400">
                    Loading discount rules...
                  </td>
                </tr>
              ) : !data || data.items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-slate-400">
                    No discount rules found.
                  </td>
                </tr>
              ) : (
                data.items.map((rule) => (
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
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Create Rule Modal */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Discount Rule</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Rule Name *</label>
              <Input
                placeholder="e.g. Early Bird 10%, Volume Partner 500"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Scope *</label>
                <select
                  value={scope}
                  onChange={(e) => setScope(e.target.value as any)}
                  className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm bg-white"
                >
                  <option value="subscription">Subscription (Order-level)</option>
                  <option value="product">Product (Line-item)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Discount Type *</label>
                <select
                  value={kind}
                  onChange={(e) => setKind(e.target.value as any)}
                  className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm bg-white"
                >
                  <option value="percent">Percentage (%)</option>
                  <option value="fixed">Fixed Amount (INR)</option>
                </select>
              </div>
            </div>

            {scope === "product" && (
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Target Product</label>
                <select
                  value={productId}
                  onChange={(e) => setProductId(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm bg-white"
                >
                  <option value="">Any Product</option>
                  {productsData?.items?.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Discount Value ({kind === "percent" ? "%" : "INR"}) *
              </label>
              <Input
                type="number"
                step="0.01"
                placeholder={kind === "percent" ? "10" : "500"}
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Min Purchase (INR)</label>
                <Input
                  type="number"
                  step="0.01"
                  value={minPurchase}
                  onChange={(e) => setMinPurchase(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Min Quantity</label>
                <Input
                  type="number"
                  value={minQuantity}
                  onChange={(e) => setMinQuantity(e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Start Date</label>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">End Date</label>
                <Input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Usage Limit (Optional)
              </label>
              <Input
                type="number"
                placeholder="Unlimited if empty"
                value={usageLimit}
                onChange={(e) => setUsageLimit(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsModalOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!name || !value || createRuleMutation.isPending}
              onClick={() => createRuleMutation.mutate()}
            >
              Create Rule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
