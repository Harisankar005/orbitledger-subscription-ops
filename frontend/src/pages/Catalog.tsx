import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { formatCurrency } from "@/lib/utils";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/Dialog";
import { Package, Layers, Percent, Clock, Plus, Tag, ShieldCheck, Check, FileText, Pencil } from "lucide-react";

export function Catalog() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<"products" | "plans" | "taxes" | "terms" | "templates">("products");

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

  // Quotation Template modal
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
  const [editingTemplateId, setEditingTemplateId] = useState<number | null>(null);
  const [templateName, setTemplateName] = useState("");
  const [templatePlanId, setTemplatePlanId] = useState<number | "">("");
  const [templateValidity, setTemplateValidity] = useState("30");
  const [templateTermId, setTemplateTermId] = useState<number | "">("");
  const [templateIsActive, setTemplateIsActive] = useState(true);

  // Queries
  const { data: productsData } = useQuery({
    queryKey: ["catalog-products"],
    queryFn: () => api.get<{ items: any[]; total: number }>("/products"),
  });

  const { data: plansData } = useQuery({
    queryKey: ["catalog-plans"],
    queryFn: () => api.get<{ items: any[]; total: number }>("/plans"),
  });

  const { data: taxesData } = useQuery({
    queryKey: ["catalog-taxes"],
    queryFn: () => api.get<{ items: any[]; total: number }>("/taxes"),
  });

  const { data: taxRulesData } = useQuery({
    queryKey: ["catalog-tax-rules"],
    queryFn: () => api.get<{ items: any[]; total: number }>("/tax-rules"),
  });

  const { data: termsData } = useQuery({
    queryKey: ["catalog-payment-terms"],
    queryFn: () => api.get<{ items: any[]; total: number }>("/payment-terms"),
  });

  const { data: templatesData } = useQuery({
    queryKey: ["catalog-quotation-templates"],
    queryFn: () => api.get<{ items: any[]; total: number }>("/quotation-templates"),
  });

  // Mutations
  const createProductMutation = useMutation({
    mutationFn: () =>
      api.post("/products", {
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
      api.post(`/products/${selectedProductId}/variants`, {
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
      api.post("/plans", {
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

  const saveTemplateMutation = useMutation({
    mutationFn: () => {
      const payload = {
        name: templateName,
        plan_id: Number(templatePlanId),
        validity_days: parseInt(templateValidity, 10) || 30,
        payment_term_id: Number(templateTermId),
        is_active: templateIsActive,
      };
      if (editingTemplateId) {
        return api.patch(`/quotation-templates/${editingTemplateId}`, payload);
      }
      return api.post("/quotation-templates", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["catalog-quotation-templates"] });
      queryClient.invalidateQueries({ queryKey: ["quotation-templates"] });
      setIsTemplateModalOpen(false);
      setEditingTemplateId(null);
      setTemplateName("");
      setTemplatePlanId("");
      setTemplateValidity("30");
      setTemplateTermId("");
      setTemplateIsActive(true);
    },
    onError: (err: any) => {
      alert(`Failed to save template: ${err.message || "Invalid input"}`);
    },
  });

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Catalog & Plans</h1>
          <p className="text-sm text-slate-500 mt-1">
            Configure subscription tiers, add-ons, Odoo variants, tax rules, payment terms, and quotation templates.
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
          {activeTab === "templates" && (
            <Button
              size="sm"
              onClick={() => {
                setEditingTemplateId(null);
                setTemplateName("");
                setTemplatePlanId(plansData?.items?.[0]?.id || "");
                setTemplateValidity("30");
                setTemplateTermId(termsData?.items?.[0]?.id || "");
                setTemplateIsActive(true);
                setIsTemplateModalOpen(true);
              }}
            >
              <Plus className="h-4 w-4 mr-1.5" />
              New Template
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
        <button
          onClick={() => setActiveTab("templates")}
          className={`flex items-center px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "templates"
              ? "border-indigo-600 text-indigo-600 font-semibold"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          <FileText className="h-4 w-4 mr-2" />
          Quotation Templates
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
                    <th className="px-6 py-3 text-left font-semibold text-slate-600">Product Name</th>
                    <th className="px-6 py-3 text-left font-semibold text-slate-600">Type</th>
                    <th className="px-6 py-3 text-right font-semibold text-slate-600">Sales Price</th>
                    <th className="px-6 py-3 text-right font-semibold text-slate-600">Cost Price</th>
                    <th className="px-6 py-3 text-left font-semibold text-slate-600">Variants</th>
                    <th className="px-6 py-3 text-right font-semibold text-slate-600">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {productsData?.items?.map((product) => (
                    <tr key={product.id} className="hover:bg-slate-50">
                      <td className="px-6 py-4 font-medium text-slate-900">
                        {product.name}
                        {product.notes && (
                          <div className="text-xs text-slate-400 font-normal">{product.notes}</div>
                        )}
                      </td>
                      <td className="px-6 py-4 capitalize">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-800">
                          {product.type}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right font-mono text-slate-900">
                        {formatCurrency(product.sales_price)}
                      </td>
                      <td className="px-6 py-4 text-right font-mono text-slate-500">
                        {formatCurrency(product.cost_price)}
                      </td>
                      <td className="px-6 py-4">
                        {product.variants && product.variants.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {product.variants.map((v: any) => (
                              <span
                                key={v.id}
                                className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-indigo-50 text-indigo-700 font-medium"
                              >
                                {v.attribute}: {v.value} (+{formatCurrency(v.extra_price)})
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">None</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setSelectedProductId(product.id);
                            setIsVariantModalOpen(true);
                          }}
                        >
                          <Tag className="h-3.5 w-3.5 mr-1" />
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
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-bold text-lg text-slate-900">{plan.name}</h3>
                    <span className="text-xs font-semibold uppercase text-indigo-600 tracking-wider">
                      {plan.billing_period}
                    </span>
                  </div>
                  <span className="text-xl font-mono font-bold text-slate-900">
                    {formatCurrency(plan.price)}
                  </span>
                </div>

                <div className="mt-4 space-y-2 text-xs text-slate-600 border-t border-slate-100 pt-3">
                  <div className="flex justify-between">
                    <span>Min Line Quantity:</span>
                    <span className="font-semibold text-slate-800">{plan.min_quantity}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Default Tax:</span>
                    <span className="font-semibold text-slate-800">{plan.default_tax?.name || "None"}</span>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-100 space-y-1">
                  <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">
                    Contract Policy Gates
                  </div>
                  <div className="flex items-center text-xs text-slate-600">
                    <ShieldCheck className={`h-3.5 w-3.5 mr-1.5 ${plan.allow_pause ? "text-emerald-500" : "text-slate-300"}`} />
                    {plan.allow_pause ? "Customer pause permitted" : "Pause forbidden"}
                  </div>
                  <div className="flex items-center text-xs text-slate-600">
                    <ShieldCheck className={`h-3.5 w-3.5 mr-1.5 ${plan.allow_early_close ? "text-emerald-500" : "text-slate-300"}`} />
                    {plan.allow_early_close ? "Early close permitted" : "Early close forbidden"}
                  </div>
                  <div className="flex items-center text-xs text-slate-600">
                    <ShieldCheck className={`h-3.5 w-3.5 mr-1.5 ${plan.allow_renew ? "text-emerald-500" : "text-slate-300"}`} />
                    {plan.allow_renew ? "Renewals allowed" : "Renewal forbidden"}
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Tab: Taxes & Tax Rules */}
      {activeTab === "taxes" && (
        <div className="space-y-6">
          <div>
            <h2 className="text-base font-bold text-slate-800 mb-3">Configured Taxes</h2>
            <Card className="bg-white border border-slate-200 overflow-hidden">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-6 py-3 text-left font-semibold text-slate-600">Tax Name</th>
                    <th className="px-6 py-3 text-left font-semibold text-slate-600">Kind</th>
                    <th className="px-6 py-3 text-right font-semibold text-slate-600">Rate</th>
                    <th className="px-6 py-3 text-right font-semibold text-slate-600">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {taxesData?.items?.map((tax) => (
                    <tr key={tax.id} className="hover:bg-slate-50">
                      <td className="px-6 py-4 font-medium text-slate-900">{tax.name}</td>
                      <td className="px-6 py-4 capitalize text-slate-600">{tax.kind}</td>
                      <td className="px-6 py-4 text-right font-mono font-medium text-slate-900">
                        {tax.kind === "percent" ? `${tax.rate}%` : formatCurrency(tax.rate)}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                          tax.is_active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
                        }`}>
                          {tax.is_active ? "Active" : "Inactive"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>

          <div>
            <h2 className="text-base font-bold text-slate-800 mb-3">Product Type Resolution Rules (Priority Order)</h2>
            <Card className="bg-white border border-slate-200 overflow-hidden">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-6 py-3 text-left font-semibold text-slate-600">Priority</th>
                    <th className="px-6 py-3 text-left font-semibold text-slate-600">Product Type</th>
                    <th className="px-6 py-3 text-left font-semibold text-slate-600">Mapped Tax</th>
                    <th className="px-6 py-3 text-right font-semibold text-slate-600">Applied Rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {taxRulesData?.items?.map((rule) => (
                    <tr key={rule.id} className="hover:bg-slate-50">
                      <td className="px-6 py-4 font-mono font-bold text-indigo-600">{rule.priority}</td>
                      <td className="px-6 py-4 capitalize font-medium text-slate-900">{rule.product_type}</td>
                      <td className="px-6 py-4 text-slate-700">{rule.tax?.name}</td>
                      <td className="px-6 py-4 text-right font-mono text-slate-900">
                        {rule.tax?.kind === "percent" ? `${rule.tax?.rate}%` : formatCurrency(rule.tax?.rate || 0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>
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

      {/* Tab: Quotation Templates */}
      {activeTab === "templates" && (
        <Card className="bg-white border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-6 py-3 text-left font-semibold text-slate-600">Template Name</th>
                  <th className="px-6 py-3 text-left font-semibold text-slate-600">Associated Plan</th>
                  <th className="px-6 py-3 text-center font-semibold text-slate-600">Validity</th>
                  <th className="px-6 py-3 text-left font-semibold text-slate-600">Payment Term</th>
                  <th className="px-6 py-3 text-center font-semibold text-slate-600">Status</th>
                  <th className="px-6 py-3 text-right font-semibold text-slate-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {templatesData?.items?.map((tpl) => (
                  <tr key={tpl.id} className="hover:bg-slate-50">
                    <td className="px-6 py-4 font-medium text-slate-900">{tpl.name}</td>
                    <td className="px-6 py-4 text-slate-700">{tpl.plan?.name || "No plan"}</td>
                    <td className="px-6 py-4 text-center font-mono text-slate-700">{tpl.validity_days} days</td>
                    <td className="px-6 py-4 text-slate-700">{tpl.payment_term?.name || "Immediate"}</td>
                    <td className="px-6 py-4 text-center">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                          tpl.is_active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {tpl.is_active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setEditingTemplateId(tpl.id);
                          setTemplateName(tpl.name);
                          setTemplatePlanId(tpl.plan_id);
                          setTemplateValidity(String(tpl.validity_days));
                          setTemplateTermId(tpl.payment_term_id);
                          setTemplateIsActive(tpl.is_active);
                          setIsTemplateModalOpen(true);
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5 mr-1" />
                        Edit
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
            <DialogTitle>Add Variant Option</DialogTitle>
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
                placeholder="e.g. Enterprise Monthly"
                value={planName}
                onChange={(e) => setPlanName(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Base Price (INR) *</label>
                <Input
                  type="number"
                  step="0.01"
                  placeholder="1999.00"
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

      {/* Create / Edit Quotation Template Modal */}
      <Dialog open={isTemplateModalOpen} onOpenChange={setIsTemplateModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingTemplateId ? "Edit Quotation Template" : "New Quotation Template"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Template Name *</label>
              <Input
                placeholder="e.g. Standard SaaS Bundle"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Associated Plan *</label>
              <select
                value={templatePlanId}
                onChange={(e) => setTemplatePlanId(e.target.value ? Number(e.target.value) : "")}
                className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm bg-white"
              >
                <option value="">Select Plan</option>
                {plansData?.items?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({formatCurrency(p.price)} / {p.billing_period})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Validity (Days) *</label>
              <Input
                type="number"
                min="1"
                placeholder="30"
                value={templateValidity}
                onChange={(e) => setTemplateValidity(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Payment Term *</label>
              <select
                value={templateTermId}
                onChange={(e) => setTemplateTermId(e.target.value ? Number(e.target.value) : "")}
                className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm bg-white"
              >
                <option value="">Select Payment Term</option>
                {termsData?.items?.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.days === 0 ? "Immediate" : `${t.days} days`})
                  </option>
                ))}
              </select>
            </div>
            <div className="pt-2">
              <label className="flex items-center space-x-2 text-sm text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={templateIsActive}
                  onChange={(e) => setTemplateIsActive(e.target.checked)}
                  className="rounded text-indigo-600 focus:ring-indigo-500 h-4 w-4"
                />
                <span>Active Template</span>
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsTemplateModalOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!templateName || !templatePlanId || !templateTermId || saveTemplateMutation.isPending}
              onClick={() => saveTemplateMutation.mutate()}
            >
              {editingTemplateId ? "Save Changes" : "Create Template"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
