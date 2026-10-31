import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { formatCurrency } from "@/lib/utils";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/Dialog";
import { Package, Layers, Percent, Clock, Plus, Tag, ShieldCheck, Check } from "lucide-react";

export function Catalog() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<"products" | "plans" | "taxes" | "terms">("products");

  // Product modal
  const [isProductModalOpen, setIsProductModalOpen] = useState(false);
  const [productName, setProductName] = useState("");
  const [productType, setProductType] = useState("software");
  const [salesPrice, setSalesPrice] = useState("");
  const [costPrice, setCostPrice] = useState("0");
  const [productNotes, setProductNotes] = useState("");

  // Variant modal
  const [isVariantModalOpen, setIsVariantModalOpen] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState<number | null>(null);
  const [variantAttr, setVariantAttr] = useState("Brand");
  const [variantVal, setVariantVal] = useState("Odoo");
  const [variantExtraPrice, setVariantExtraPrice] = useState("560.00");

  // Plan modal
  const [isPlanModalOpen, setIsPlanModalOpen] = useState(false);
  const [planName, setPlanName] = useState("");
  const [planPrice, setPlanPrice] = useState("");
  const [planPeriod, setPlanPeriod] = useState<"daily" | "weekly" | "monthly" | "yearly">("monthly");
  const [minQty, setMinQty] = useState("1");
  const [autoClose, setAutoClose] = useState(false);
  const [allowEarlyClose, setAllowEarlyClose] = useState(true);
  const [allowPause, setAllowPause] = useState(true);
  const [allowRenew, setAllowRenew] = useState(true);

  // Queries
  const { data: productsData } = useQuery({
    queryKey: ["catalog-products"],
    queryFn: () => api.get<{ items: any[]; total: number }>("/catalog/products"),
  });

  const { data: plansData } = useQuery({
    queryKey: ["catalog-plans"],
    queryFn: () => api.get<{ items: any[]; total: number }>("/catalog/plans"),
  });

  const { data: taxesData } = useQuery({
    queryKey: ["catalog-taxes"],
    queryFn: () => api.get<{ items: any[]; total: number }>("/catalog/taxes"),
  });

  const { data: taxRulesData } = useQuery({
    queryKey: ["catalog-tax-rules"],
    queryFn: () => api.get<{ items: any[]; total: number }>("/catalog/tax-rules"),
  });

  const { data: termsData } = useQuery({
    queryKey: ["catalog-payment-terms"],
    queryFn: () => api.get<{ items: any[]; total: number }>("/catalog/payment-terms"),
  });

  // Mutations
  const createProductMutation = useMutation({
    mutationFn: () =>
      api.post("/catalog/products", {
        name: productName,
        type: productType,
        sales_price: parseFloat(salesPrice),
        cost_price: parseFloat(costPrice) || 0,
        notes: productNotes || undefined,
        is_active: true,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["catalog-products"] });
      setIsProductModalOpen(false);
      setProductName("");
      setSalesPrice("");
      setProductNotes("");
    },
  });

  const addVariantMutation = useMutation({
    mutationFn: () =>
      api.post(`/catalog/products/${selectedProductId}/variants`, {
        attribute: variantAttr,
        value: variantVal,
        extra_price: parseFloat(variantExtraPrice) || 0,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["catalog-products"] });
      setIsVariantModalOpen(false);
      setSelectedProductId(null);
    },
  });

  const createPlanMutation = useMutation({
    mutationFn: () =>
      api.post("/catalog/plans", {
        name: planName,
        price: parseFloat(planPrice),
        billing_period: planPeriod,
        min_quantity: parseInt(minQty, 10) || 1,
        auto_close_on_end: autoClose,
        allow_early_close: allowEarlyClose,
        allow_pause: allowPause,
        allow_renew: allowRenew,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["catalog-plans"] });
      setIsPlanModalOpen(false);
      setPlanName("");
      setPlanPrice("");
    },
  });

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Catalog & Plans</h1>
          <p className="text-sm text-slate-500 mt-1">
            Configure subscription tiers, add-ons, Odoo variants, tax rules, and payment terms.
          </p>
        </div>
        <div className="flex space-x-2">
          {activeTab === "products" && (
            <Button size="sm" onClick={() => setIsProductModalOpen(true)}>
              <Plus className="h-4 w-4 mr-1.5" />
              Add Product
            </Button>
          )}
          {activeTab === "plans" && (
            <Button size="sm" onClick={() => setIsPlanModalOpen(true)}>
              <Plus className="h-4 w-4 mr-1.5" />
              New Plan
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex space-x-2 border-b border-slate-200">
        <button
          onClick={() => setActiveTab("products")}
          className={`flex items-center px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "products"
              ? "border-indigo-600 text-indigo-600 font-semibold"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          <Package className="h-4 w-4 mr-2" />
          Products & Variants
        </button>
        <button
          onClick={() => setActiveTab("plans")}
          className={`flex items-center px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "plans"
              ? "border-indigo-600 text-indigo-600 font-semibold"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          <Layers className="h-4 w-4 mr-2" />
          Subscription Plans
        </button>
        <button
          onClick={() => setActiveTab("taxes")}
          className={`flex items-center px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "taxes"
              ? "border-indigo-600 text-indigo-600 font-semibold"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          <Percent className="h-4 w-4 mr-2" />
          Taxes & Rules
        </button>
        <button
          onClick={() => setActiveTab("terms")}
          className={`flex items-center px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "terms"
              ? "border-indigo-600 text-indigo-600 font-semibold"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          <Clock className="h-4 w-4 mr-2" />
          Payment Terms
        </button>
      </div>

      {/* Tab: Products */}
      {activeTab === "products" && (
        <div className="grid grid-cols-1 gap-4">
          <Card className="overflow-hidden border border-slate-200 bg-white">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-6 py-3 text-left font-semibold text-slate-600">Product</th>
                    <th className="px-6 py-3 text-left font-semibold text-slate-600">Type</th>
                    <th className="px-6 py-3 text-right font-semibold text-slate-600">Base Price</th>
                    <th className="px-6 py-3 text-left font-semibold text-slate-600">Configured Variants</th>
                    <th className="px-6 py-3 text-right font-semibold text-slate-600">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {productsData?.items?.map((prod) => (
                    <tr key={prod.id} className="hover:bg-slate-50">
                      <td className="px-6 py-4">
                        <div className="font-semibold text-slate-900">{prod.name}</div>
                        {prod.notes && (
                          <div className="text-xs text-slate-400 mt-0.5">{prod.notes}</div>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <span className="capitalize px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700">
                          {prod.type}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right font-mono font-medium text-slate-900">
                        {formatCurrency(prod.sales_price)}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-wrap gap-1.5">
                          {prod.variants && prod.variants.length > 0 ? (
                            prod.variants.map((v: any) => (
                              <span
                                key={v.id}
                                className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-indigo-50 text-indigo-700 border border-indigo-100 font-mono"
                              >
                                {v.attribute}: {v.value} (+{formatCurrency(v.extra_price)})
                              </span>
                            ))
                          ) : (
                            <span className="text-xs text-slate-400">None</span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setSelectedProductId(prod.id);
                            setIsVariantModalOpen(true);
                          }}
                        >
                          <Plus className="h-3.5 w-3.5 mr-1" />
                          Add Variant
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* Tab: Plans */}
      {activeTab === "plans" && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {plansData?.items?.map((plan) => (
            <Card key={plan.id} className="p-6 bg-white border border-slate-200 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-lg font-bold text-slate-900">{plan.name}</h3>
                  <Badge variant="outline" className="capitalize">
                    {plan.billing_period}
                  </Badge>
                </div>

                <div className="text-2xl font-black text-slate-900 my-4">
                  {formatCurrency(plan.price)}
                  <span className="text-xs font-normal text-slate-500"> / {plan.billing_period}</span>
                </div>

                <div className="space-y-2 text-xs text-slate-600 border-t border-slate-100 pt-4">
                  <div className="flex items-center justify-between">
                    <span>Min Line Quantity:</span>
                    <span className="font-semibold text-slate-800">{plan.min_quantity}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Customer Pause:</span>
                    <span className={plan.allow_pause ? "text-emerald-600 font-medium" : "text-slate-400"}>
                      {plan.allow_pause ? "Allowed" : "Disabled"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Early Close:</span>
                    <span className={plan.allow_early_close ? "text-emerald-600 font-medium" : "text-slate-400"}>
                      {plan.allow_early_close ? "Allowed" : "Disabled"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Auto-close on Expiry:</span>
                    <span className={plan.auto_close_on_end ? "text-indigo-600 font-medium" : "text-slate-400"}>
                      {plan.auto_close_on_end ? "Yes" : "No"}
                    </span>
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Tab: Taxes & Rules */}
      {activeTab === "taxes" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Defined Taxes */}
          <Card className="p-5 bg-white border border-slate-200">
            <h3 className="font-bold text-slate-900 mb-4 flex items-center">
              <Percent className="h-4 w-4 mr-2 text-indigo-600" />
              Tax Rates
            </h3>
            <div className="divide-y divide-slate-100">
              {taxesData?.items?.map((tax) => (
                <div key={tax.id} className="py-3 flex items-center justify-between">
                  <div>
                    <div className="font-medium text-slate-900 text-sm">{tax.name}</div>
                    <div className="text-xs text-slate-400 capitalize">{tax.kind}</div>
                  </div>
                  <div className="font-mono font-semibold text-slate-800 text-sm">
                    {tax.kind === "percent" ? `${tax.rate}%` : formatCurrency(tax.rate)}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* Tax Precedence Rules */}
          <Card className="p-5 bg-white border border-slate-200">
            <h3 className="font-bold text-slate-900 mb-1 flex items-center">
              <ShieldCheck className="h-4 w-4 mr-2 text-indigo-600" />
              Tax Resolution Rules
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              Precedence: Explicit Line Override &gt; Product Default &gt; Tax Rules by Priority &gt; Zero Tax
            </p>
            <div className="divide-y divide-slate-100">
              {taxRulesData?.items?.map((rule) => (
                <div key={rule.id} className="py-3 flex items-center justify-between">
                  <div>
                    <div className="font-medium text-slate-900 text-sm">
                      Target: {rule.product_type ? `Type = ${rule.product_type}` : "All Products"}
                    </div>
                    <div className="text-xs text-slate-400">
                      Tax: {rule.tax?.name || `Tax #${rule.tax_id}`}
                    </div>
                  </div>
                  <span className="font-mono text-xs px-2.5 py-1 bg-slate-100 text-slate-700 rounded font-semibold">
                    Priority {rule.priority}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {/* Tab: Payment Terms */}
      {activeTab === "terms" && (
        <Card className="bg-white border border-slate-200 overflow-hidden max-w-2xl">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-6 py-3 text-left font-semibold text-slate-600">Term Name</th>
                <th className="px-6 py-3 text-right font-semibold text-slate-600">Due Days</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {termsData?.items?.map((term) => (
                <tr key={term.id} className="hover:bg-slate-50">
                  <td className="px-6 py-4 font-medium text-slate-900">{term.name}</td>
                  <td className="px-6 py-4 text-right font-mono text-slate-700">
                    {term.days === 0 ? "Immediate (0 days)" : `${term.days} days`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {/* Add Product Modal */}
      <Dialog open={isProductModalOpen} onOpenChange={setIsProductModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add New Product</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Product Name *</label>
              <Input
                placeholder="e.g. Additional Seat, Odoo Connector"
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Product Type *</label>
              <select
                value={productType}
                onChange={(e) => setProductType(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm bg-white"
              >
                <option value="software">Software</option>
                <option value="addon">Add-on</option>
                <option value="service">Service</option>
                <option value="physical">Physical</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Sales Price (INR) *</label>
              <Input
                type="number"
                step="0.01"
                placeholder="0.00"
                value={salesPrice}
                onChange={(e) => setSalesPrice(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Cost Price (INR)</label>
              <Input
                type="number"
                step="0.01"
                placeholder="0.00"
                value={costPrice}
                onChange={(e) => setCostPrice(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Notes</label>
              <Input
                placeholder="Optional catalog notes"
                value={productNotes}
                onChange={(e) => setProductNotes(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsProductModalOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!productName || !salesPrice || createProductMutation.isPending}
              onClick={() => createProductMutation.mutate()}
            >
              Save Product
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Variant Modal */}
      <Dialog open={isVariantModalOpen} onOpenChange={setIsVariantModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Product Variant</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Attribute Name *</label>
              <Input
                placeholder="e.g. Brand, Color, Size"
                value={variantAttr}
                onChange={(e) => setVariantAttr(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Attribute Value *</label>
              <Input
                placeholder="e.g. Odoo, Enterprise, Cloud"
                value={variantVal}
                onChange={(e) => setVariantVal(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Extra Price Delta (INR) *</label>
              <Input
                type="number"
                step="0.01"
                placeholder="e.g. 560.00"
                value={variantExtraPrice}
                onChange={(e) => setVariantExtraPrice(e.target.value)}
              />
              <span className="text-[11px] text-slate-400 mt-1 block">
                Can be positive, negative, or zero.
              </span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsVariantModalOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!variantAttr || !variantVal || addVariantMutation.isPending}
              onClick={() => addVariantMutation.mutate()}
            >
              Add Variant
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Plan Modal */}
      <Dialog open={isPlanModalOpen} onOpenChange={setIsPlanModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Subscription Plan</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Plan Name *</label>
              <Input
                placeholder="e.g. Professional Yearly"
                value={planName}
                onChange={(e) => setPlanName(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Base Recurring Fee *</label>
                <Input
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={planPrice}
                  onChange={(e) => setPlanPrice(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Billing Period *</label>
                <select
                  value={planPeriod}
                  onChange={(e) => setPlanPeriod(e.target.value as any)}
                  className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm bg-white"
                >
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="yearly">Yearly</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Minimum Product Quantity</label>
              <Input
                type="number"
                value={minQty}
                onChange={(e) => setMinQty(e.target.value)}
              />
            </div>
            <div className="space-y-2 pt-2">
              <label className="flex items-center space-x-2 text-sm text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={allowPause}
                  onChange={(e) => setAllowPause(e.target.checked)}
                  className="rounded text-indigo-600 focus:ring-indigo-500 h-4 w-4"
                />
                <span>Allow customer to pause</span>
              </label>
              <label className="flex items-center space-x-2 text-sm text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={allowEarlyClose}
                  onChange={(e) => setAllowEarlyClose(e.target.checked)}
                  className="rounded text-indigo-600 focus:ring-indigo-500 h-4 w-4"
                />
                <span>Allow early closure by customer</span>
              </label>
              <label className="flex items-center space-x-2 text-sm text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={allowRenew}
                  onChange={(e) => setAllowRenew(e.target.checked)}
                  className="rounded text-indigo-600 focus:ring-indigo-500 h-4 w-4"
                />
                <span>Allow renewals</span>
              </label>
              <label className="flex items-center space-x-2 text-sm text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoClose}
                  onChange={(e) => setAutoClose(e.target.checked)}
                  className="rounded text-indigo-600 focus:ring-indigo-500 h-4 w-4"
                />
                <span>Auto-close when expiry date is reached</span>
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsPlanModalOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!planName || !planPrice || createPlanMutation.isPending}
              onClick={() => createPlanMutation.mutate()}
            >
              Create Plan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
