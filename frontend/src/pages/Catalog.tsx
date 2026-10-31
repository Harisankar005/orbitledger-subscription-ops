import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { api } from "@/api/client";
import { formatCurrency } from "@/lib/utils";
import { useToast } from "@/context/ToastContext";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/Dialog";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  productSchema, ProductFormData,
  variantSchema, VariantFormData,
  planSchema, PlanFormData,
  taxSchema, TaxFormData,
  taxRuleSchema, TaxRuleFormData,
  paymentTermSchema, PaymentTermFormData,
  quotationTemplateSchema, QuotationTemplateFormData,
} from "@/lib/schemas";
import { handleServerErrors } from "@/lib/form-errors";
import { Package, Layers, Percent, Clock, Plus, Tag, ShieldCheck, FileText, Pencil } from "lucide-react";

export function Catalog() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<"products" | "plans" | "taxes" | "terms" | "templates">("products");

  // Modal open states
  const [isProductModalOpen, setIsProductModalOpen] = useState(false);
  const [isVariantModalOpen, setIsVariantModalOpen] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState<number | null>(null);
  const [isPlanModalOpen, setIsPlanModalOpen] = useState(false);
  const [isTaxModalOpen, setIsTaxModalOpen] = useState(false);
  const [isTaxRuleModalOpen, setIsTaxRuleModalOpen] = useState(false);
  const [isTermModalOpen, setIsTermModalOpen] = useState(false);
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
  const [editingTemplateId, setEditingTemplateId] = useState<number | null>(null);

  // Queries
  const { data: productsData, isLoading: isProductsLoading } = useQuery({
    queryKey: ["catalog-products"],
    queryFn: () => api.get<{ items: any[]; total: number }>("/products"),
  });

  const { data: plansData, isLoading: isPlansLoading } = useQuery({
    queryKey: ["catalog-plans"],
    queryFn: () => api.get<{ items: any[]; total: number }>("/plans"),
  });

  const { data: taxesData, isLoading: isTaxesLoading } = useQuery({
    queryKey: ["catalog-taxes"],
    queryFn: () => api.get<{ items: any[]; total: number }>("/taxes"),
  });

  const { data: taxRulesData, isLoading: isTaxRulesLoading } = useQuery({
    queryKey: ["catalog-tax-rules"],
    queryFn: () => api.get<{ items: any[]; total: number }>("/tax-rules"),
  });

  const { data: termsData, isLoading: isTermsLoading } = useQuery({
    queryKey: ["catalog-payment-terms"],
    queryFn: () => api.get<{ items: any[]; total: number }>("/payment-terms"),
  });

  const { data: templatesData, isLoading: isTemplatesLoading } = useQuery({
    queryKey: ["catalog-quotation-templates"],
    queryFn: () => api.get<{ items: any[]; total: number }>("/quotation-templates"),
  });

  // 1. Product Form
  const productForm = useForm<ProductFormData>({
    resolver: zodResolver(productSchema),
    defaultValues: {
      name: "",
      type: "software",
      sales_price: 0,
      cost_price: 0,
      notes: "",
      is_active: true,
    },
  });

  const createProductMutation = useMutation({
    mutationFn: (data: ProductFormData) => api.post("/products", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["catalog-products"] });
      toast.success("Product created successfully!");
      setIsProductModalOpen(false);
      productForm.reset();
    },
    onError: (err: any) => handleServerErrors(err, productForm.setError, toast, "Failed to create product"),
  });

  // 2. Variant Form
  const variantForm = useForm<VariantFormData>({
    resolver: zodResolver(variantSchema),
    defaultValues: {
      attribute: "Brand",
      value: "Odoo",
      extra_price: 0,
    },
  });

  const addVariantMutation = useMutation({
    mutationFn: (data: VariantFormData) =>
      api.post(`/products/${selectedProductId}/variants`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["catalog-products"] });
      toast.success("Variant added successfully!");
      setIsVariantModalOpen(false);
      setSelectedProductId(null);
      variantForm.reset();
    },
    onError: (err: any) => handleServerErrors(err, variantForm.setError, toast, "Failed to add variant"),
  });

  // 3. Plan Form
  const todayStr = new Date().toISOString().split("T")[0];
  const nextYearStr = new Date(Date.now() + 365 * 86400000).toISOString().split("T")[0];

  const planForm = useForm<PlanFormData>({
    resolver: zodResolver(planSchema),
    defaultValues: {
      name: "",
      price: 0,
      billing_period: "monthly",
      min_quantity: 0,
      available_from: todayStr,
      available_to: nextYearStr,
      auto_close_on_end: true,
      allow_early_close: true,
      allow_pause: true,
      allow_renew: true,
    },
  });

  const createPlanMutation = useMutation({
    mutationFn: (data: PlanFormData) => api.post("/plans", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["catalog-plans"] });
      toast.success("Subscription plan created successfully!");
      setIsPlanModalOpen(false);
      planForm.reset();
    },
    onError: (err: any) => handleServerErrors(err, planForm.setError, toast, "Failed to create plan"),
  });

  // 4. Tax Form
  const taxForm = useForm<TaxFormData>({
    resolver: zodResolver(taxSchema),
    defaultValues: {
      name: "",
      kind: "percent",
      rate: 18,
      is_active: true,
    },
  });

  const createTaxMutation = useMutation({
    mutationFn: (data: TaxFormData) => api.post("/taxes", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["catalog-taxes"] });
      toast.success("Tax rate added successfully!");
      setIsTaxModalOpen(false);
      taxForm.reset();
    },
    onError: (err: any) => handleServerErrors(err, taxForm.setError, toast, "Failed to create tax"),
  });

  // 5. Tax Rule Form
  const taxRuleForm = useForm<TaxRuleFormData>({
    resolver: zodResolver(taxRuleSchema),
    defaultValues: {
      product_type: "software",
      tax_id: 1,
      priority: 10,
      is_active: true,
    },
  });

  const createTaxRuleMutation = useMutation({
    mutationFn: (data: TaxRuleFormData) => api.post("/tax-rules", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["catalog-tax-rules"] });
      toast.success("Tax rule created successfully!");
      setIsTaxRuleModalOpen(false);
      taxRuleForm.reset();
    },
    onError: (err: any) => handleServerErrors(err, taxRuleForm.setError, toast, "Failed to create tax rule"),
  });

  // 6. Payment Term Form
  const termForm = useForm<PaymentTermFormData>({
    resolver: zodResolver(paymentTermSchema),
    defaultValues: {
      name: "",
      days: 30,
    },
  });

  const createTermMutation = useMutation({
    mutationFn: (data: PaymentTermFormData) => api.post("/payment-terms", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["catalog-payment-terms"] });
      toast.success("Payment term created successfully!");
      setIsTermModalOpen(false);
      termForm.reset();
    },
    onError: (err: any) => handleServerErrors(err, termForm.setError, toast, "Failed to create payment term"),
  });

  // 7. Quotation Template Form
  const templateForm = useForm<QuotationTemplateFormData>({
    resolver: zodResolver(quotationTemplateSchema),
    defaultValues: {
      name: "",
      plan_id: 1,
      validity_days: 30,
      payment_term_id: 1,
      is_active: true,
    },
  });

  const saveTemplateMutation = useMutation({
    mutationFn: (data: QuotationTemplateFormData) => {
      if (editingTemplateId) {
        return api.patch(`/quotation-templates/${editingTemplateId}`, data);
      }
      return api.post("/quotation-templates", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["catalog-quotation-templates"] });
      queryClient.invalidateQueries({ queryKey: ["quotation-templates"] });
      toast.success(editingTemplateId ? "Template updated successfully!" : "Template created successfully!");
      setIsTemplateModalOpen(false);
      setEditingTemplateId(null);
      templateForm.reset();
    },
    onError: (err: any) => handleServerErrors(err, templateForm.setError, toast, "Failed to save quotation template"),
  });

  const openNewTemplateModal = () => {
    setEditingTemplateId(null);
    templateForm.reset({
      name: "",
      plan_id: plansData?.items?.[0]?.id || 1,
      validity_days: 30,
      payment_term_id: termsData?.items?.[0]?.id || 1,
      is_active: true,
    });
    setIsTemplateModalOpen(true);
  };

  const openEditTemplateModal = (tpl: any) => {
    setEditingTemplateId(tpl.id);
    templateForm.reset({
      name: tpl.name,
      plan_id: tpl.plan_id,
      validity_days: tpl.validity_days,
      payment_term_id: tpl.payment_term_id,
      is_active: tpl.is_active,
    });
    setIsTemplateModalOpen(true);
  };

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
        <div className="flex flex-wrap gap-2">
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
          {activeTab === "taxes" && (
            <>
              <Button variant="outline" size="sm" onClick={() => setIsTaxRuleModalOpen(true)}>
                <Plus className="h-4 w-4 mr-1.5" />
                Add Tax Rule
              </Button>
              <Button size="sm" onClick={() => setIsTaxModalOpen(true)}>
                <Plus className="h-4 w-4 mr-1.5" />
                Add Tax Rate
              </Button>
            </>
          )}
          {activeTab === "terms" && (
            <Button size="sm" onClick={() => setIsTermModalOpen(true)}>
              <Plus className="h-4 w-4 mr-1.5" />
              New Payment Term
            </Button>
          )}
          {activeTab === "templates" && (
            <Button size="sm" onClick={openNewTemplateModal}>
              <Plus className="h-4 w-4 mr-1.5" />
              New Template
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex space-x-2 border-b border-slate-200 overflow-x-auto">
        <button
          onClick={() => setActiveTab("products")}
          className={`flex items-center px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
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
          className={`flex items-center px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
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
          className={`flex items-center px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
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
          className={`flex items-center px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
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
          className={`flex items-center px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
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
        <Card className="overflow-hidden border border-slate-200 bg-white">
          {isProductsLoading ? (
            <div className="p-6">
              <TableSkeleton rows={4} cols={6} />
            </div>
          ) : !productsData || productsData.items.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={Package}
                title="No products configured"
                description="Create your first catalog item or SaaS subscription add-on."
                actionLabel="Add Product"
                onAction={() => setIsProductModalOpen(true)}
              />
            </div>
          ) : (
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
                  {productsData.items.map((product) => (
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
          )}
        </Card>
      )}

      {/* Tab: Plans */}
      {activeTab === "plans" && (
        <div>
          {isPlansLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="p-6 bg-white border border-slate-200 rounded-xl space-y-4 animate-pulse">
                  <div className="h-5 bg-slate-200 rounded w-1/2" />
                  <div className="h-8 bg-slate-200 rounded w-1/3" />
                  <div className="space-y-2 pt-4">
                    <div className="h-3 bg-slate-200 rounded" />
                    <div className="h-3 bg-slate-200 rounded" />
                  </div>
                </div>
              ))}
            </div>
          ) : !plansData || plansData.items.length === 0 ? (
            <EmptyState
              icon={Layers}
              title="No subscription plans"
              description="Define recurring billing plans for customer contracts."
              actionLabel="New Plan"
              onAction={() => setIsPlanModalOpen(true)}
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {plansData.items.map((plan) => (
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
        </div>
      )}

      {/* Tab: Taxes & Tax Rules */}
      {activeTab === "taxes" && (
        <div className="space-y-6">
          <div>
            <h2 className="text-base font-bold text-slate-800 mb-3">Configured Taxes</h2>
            <Card className="bg-white border border-slate-200 overflow-hidden">
              {isTaxesLoading ? (
                <div className="p-6">
                  <TableSkeleton rows={3} cols={4} />
                </div>
              ) : !taxesData || taxesData.items.length === 0 ? (
                <div className="p-6">
                  <EmptyState
                    icon={Percent}
                    title="No taxes configured"
                    description="Set up tax rates to automatically calculate invoices."
                    actionLabel="Add Tax Rate"
                    onAction={() => setIsTaxModalOpen(true)}
                  />
                </div>
              ) : (
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
                    {taxesData.items.map((tax) => (
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
              )}
            </Card>
          </div>

          <div>
            <h2 className="text-base font-bold text-slate-800 mb-3">Product Type Resolution Rules (Priority Order)</h2>
            <Card className="bg-white border border-slate-200 overflow-hidden">
              {isTaxRulesLoading ? (
                <div className="p-6">
                  <TableSkeleton rows={3} cols={4} />
                </div>
              ) : !taxRulesData || taxRulesData.items.length === 0 ? (
                <div className="p-6">
                  <EmptyState
                    icon={Percent}
                    title="No tax rules configured"
                    description="Configure priority-based tax resolution rules by product type."
                    actionLabel="Add Tax Rule"
                    onAction={() => setIsTaxRuleModalOpen(true)}
                  />
                </div>
              ) : (
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
                    {taxRulesData.items.map((rule) => (
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
              )}
            </Card>
          </div>
        </div>
      )}

      {/* Tab: Payment Terms */}
      {activeTab === "terms" && (
        <Card className="bg-white border border-slate-200 overflow-hidden max-w-2xl">
          {isTermsLoading ? (
            <div className="p-6">
              <TableSkeleton rows={3} cols={2} />
            </div>
          ) : !termsData || termsData.items.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={Clock}
                title="No payment terms"
                description="Configure invoice payment grace periods."
                actionLabel="New Payment Term"
                onAction={() => setIsTermModalOpen(true)}
              />
            </div>
          ) : (
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-6 py-3 text-left font-semibold text-slate-600">Term Name</th>
                  <th className="px-6 py-3 text-right font-semibold text-slate-600">Due Days</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {termsData.items.map((term) => (
                  <tr key={term.id} className="hover:bg-slate-50">
                    <td className="px-6 py-4 font-medium text-slate-900">{term.name}</td>
                    <td className="px-6 py-4 text-right font-mono text-slate-700">
                      {term.days === 0 ? "Immediate (0 days)" : `${term.days} days`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}

      {/* Tab: Quotation Templates */}
      {activeTab === "templates" && (
        <Card className="bg-white border border-slate-200 overflow-hidden">
          {isTemplatesLoading ? (
            <div className="p-6">
              <TableSkeleton rows={3} cols={6} />
            </div>
          ) : !templatesData || templatesData.items.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={FileText}
                title="No quotation templates"
                description="Create quotation templates to generate contracts with prefilled plans and terms."
                actionLabel="New Template"
                onAction={openNewTemplateModal}
              />
            </div>
          ) : (
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
                  {templatesData.items.map((tpl) => (
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
                          onClick={() => openEditTemplateModal(tpl)}
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
          )}
        </Card>
      )}

      {/* 1. Add Product Modal */}
      <Dialog open={isProductModalOpen} onOpenChange={setIsProductModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add New Product</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={productForm.handleSubmit((data) => createProductMutation.mutate(data))}
            className="space-y-4 py-2"
            noValidate
          >
            <Input
              label="Product Name"
              required
              placeholder="e.g. Additional Seat, Odoo Connector"
              error={productForm.formState.errors.name?.message}
              {...productForm.register("name")}
            />

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Product Type *</label>
              <select
                {...productForm.register("type")}
                className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm bg-white"
              >
                <option value="software">Software</option>
                <option value="addon">Add-on</option>
                <option value="service">Service</option>
                <option value="physical">Physical</option>
              </select>
              {productForm.formState.errors.type?.message && (
                <p className="mt-1 text-xs text-rose-600">{productForm.formState.errors.type.message}</p>
              )}
            </div>

            <Input
              label="Sales Price (INR)"
              type="number"
              step="0.01"
              required
              placeholder="0.00"
              error={productForm.formState.errors.sales_price?.message}
              {...productForm.register("sales_price", { valueAsNumber: true })}
            />

            <Input
              label="Cost Price (INR)"
              type="number"
              step="0.01"
              placeholder="0.00"
              error={productForm.formState.errors.cost_price?.message}
              {...productForm.register("cost_price", { valueAsNumber: true })}
            />

            <Input
              label="Notes"
              placeholder="Optional catalog notes"
              error={productForm.formState.errors.notes?.message}
              {...productForm.register("notes")}
            />

            <DialogFooter>
              <Button variant="outline" type="button" onClick={() => setIsProductModalOpen(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                isLoading={createProductMutation.isPending || productForm.formState.isSubmitting}
                disabled={createProductMutation.isPending || productForm.formState.isSubmitting}
              >
                Save Product
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 2. Add Variant Modal */}
      <Dialog open={isVariantModalOpen} onOpenChange={setIsVariantModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Variant Option</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={variantForm.handleSubmit((data) => addVariantMutation.mutate(data))}
            className="space-y-4 py-2"
            noValidate
          >
            <Input
              label="Attribute Name"
              required
              placeholder="e.g. Brand, Color, Size"
              error={variantForm.formState.errors.attribute?.message}
              {...variantForm.register("attribute")}
            />

            <Input
              label="Attribute Value"
              required
              placeholder="e.g. Odoo, Enterprise, Cloud"
              error={variantForm.formState.errors.value?.message}
              {...variantForm.register("value")}
            />

            <Input
              label="Extra Price Delta (INR)"
              type="number"
              step="0.01"
              required
              placeholder="e.g. 560.00"
              helperText="Non-negative price surcharge added to base product price"
              error={variantForm.formState.errors.extra_price?.message}
              {...variantForm.register("extra_price", { valueAsNumber: true })}
            />

            <DialogFooter>
              <Button variant="outline" type="button" onClick={() => setIsVariantModalOpen(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                isLoading={addVariantMutation.isPending || variantForm.formState.isSubmitting}
                disabled={addVariantMutation.isPending || variantForm.formState.isSubmitting}
              >
                Add Variant
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 3. Create Plan Modal */}
      <Dialog open={isPlanModalOpen} onOpenChange={setIsPlanModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Subscription Plan</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={planForm.handleSubmit((data) => createPlanMutation.mutate(data))}
            className="space-y-4 py-2"
            noValidate
          >
            <Input
              label="Plan Name"
              required
              placeholder="e.g. Enterprise Monthly"
              error={planForm.formState.errors.name?.message}
              {...planForm.register("name")}
            />

            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Base Price (INR)"
                type="number"
                step="0.01"
                required
                placeholder="1999.00"
                error={planForm.formState.errors.price?.message}
                {...planForm.register("price", { valueAsNumber: true })}
              />

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Billing Period *</label>
                <select
                  {...planForm.register("billing_period")}
                  className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm bg-white"
                >
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="yearly">Yearly</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Available From"
                type="date"
                required
                error={planForm.formState.errors.available_from?.message}
                {...planForm.register("available_from")}
              />
              <Input
                label="Available To"
                type="date"
                required
                error={planForm.formState.errors.available_to?.message}
                {...planForm.register("available_to")}
              />
            </div>

            <Input
              label="Minimum Line Quantity"
              type="number"
              min="0"
              error={planForm.formState.errors.min_quantity?.message}
              {...planForm.register("min_quantity", { valueAsNumber: true })}
            />

            <div className="space-y-2 pt-2 border-t border-slate-100">
              <label className="flex items-center space-x-2 text-sm text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  {...planForm.register("allow_pause")}
                  className="rounded text-indigo-600 focus:ring-indigo-500 h-4 w-4"
                />
                <span>Allow customer to pause</span>
              </label>
              <label className="flex items-center space-x-2 text-sm text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  {...planForm.register("allow_early_close")}
                  className="rounded text-indigo-600 focus:ring-indigo-500 h-4 w-4"
                />
                <span>Allow early closure by customer</span>
              </label>
              <label className="flex items-center space-x-2 text-sm text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  {...planForm.register("allow_renew")}
                  className="rounded text-indigo-600 focus:ring-indigo-500 h-4 w-4"
                />
                <span>Allow renewals</span>
              </label>
              <label className="flex items-center space-x-2 text-sm text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  {...planForm.register("auto_close_on_end")}
                  className="rounded text-indigo-600 focus:ring-indigo-500 h-4 w-4"
                />
                <span>Auto-close when expiry date is reached</span>
              </label>
            </div>

            <DialogFooter>
              <Button variant="outline" type="button" onClick={() => setIsPlanModalOpen(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                isLoading={createPlanMutation.isPending || planForm.formState.isSubmitting}
                disabled={createPlanMutation.isPending || planForm.formState.isSubmitting}
              >
                Create Plan
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 4. Add Tax Modal */}
      <Dialog open={isTaxModalOpen} onOpenChange={setIsTaxModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Tax Rate</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={taxForm.handleSubmit((data) => createTaxMutation.mutate(data))}
            className="space-y-4 py-2"
            noValidate
          >
            <Input
              label="Tax Name"
              required
              placeholder="e.g. GST 18%, VAT 5%"
              error={taxForm.formState.errors.name?.message}
              {...taxForm.register("name")}
            />

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Tax Kind *</label>
              <select
                {...taxForm.register("kind")}
                className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm bg-white"
              >
                <option value="percent">Percentage (%)</option>
                <option value="fixed">Fixed Amount</option>
              </select>
            </div>

            <Input
              label="Tax Rate / Percentage"
              type="number"
              step="0.01"
              required
              placeholder="18.00"
              helperText="Enter percentage (0-100) or fixed amount"
              error={taxForm.formState.errors.rate?.message}
              {...taxForm.register("rate", { valueAsNumber: true })}
            />

            <DialogFooter>
              <Button variant="outline" type="button" onClick={() => setIsTaxModalOpen(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                isLoading={createTaxMutation.isPending || taxForm.formState.isSubmitting}
                disabled={createTaxMutation.isPending || taxForm.formState.isSubmitting}
              >
                Create Tax
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 5. Add Tax Rule Modal */}
      <Dialog open={isTaxRuleModalOpen} onOpenChange={setIsTaxRuleModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Tax Resolution Rule</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={taxRuleForm.handleSubmit((data) => createTaxRuleMutation.mutate(data))}
            className="space-y-4 py-2"
            noValidate
          >
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Product Type *</label>
              <select
                {...taxRuleForm.register("product_type")}
                className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm bg-white"
              >
                <option value="software">Software</option>
                <option value="addon">Add-on</option>
                <option value="service">Service</option>
                <option value="physical">Physical</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Target Tax *</label>
              <select
                {...taxRuleForm.register("tax_id", { valueAsNumber: true })}
                className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm bg-white"
              >
                {taxesData?.items?.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.rate}%)
                  </option>
                ))}
              </select>
            </div>

            <Input
              label="Evaluation Priority"
              type="number"
              min="1"
              required
              helperText="Lower numbers take precedence during tax resolution"
              error={taxRuleForm.formState.errors.priority?.message}
              {...taxRuleForm.register("priority", { valueAsNumber: true })}
            />

            <DialogFooter>
              <Button variant="outline" type="button" onClick={() => setIsTaxRuleModalOpen(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                isLoading={createTaxRuleMutation.isPending || taxRuleForm.formState.isSubmitting}
                disabled={createTaxRuleMutation.isPending || taxRuleForm.formState.isSubmitting}
              >
                Create Tax Rule
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 6. Add Payment Term Modal */}
      <Dialog open={isTermModalOpen} onOpenChange={setIsTermModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Payment Term</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={termForm.handleSubmit((data) => createTermMutation.mutate(data))}
            className="space-y-4 py-2"
            noValidate
          >
            <Input
              label="Term Name"
              required
              placeholder="e.g. Net 30 Days, Due on Receipt"
              error={termForm.formState.errors.name?.message}
              {...termForm.register("name")}
            />

            <Input
              label="Grace Days (Due Period)"
              type="number"
              min="0"
              required
              helperText="0 indicates immediate payment upon invoice issuance"
              error={termForm.formState.errors.days?.message}
              {...termForm.register("days", { valueAsNumber: true })}
            />

            <DialogFooter>
              <Button variant="outline" type="button" onClick={() => setIsTermModalOpen(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                isLoading={createTermMutation.isPending || termForm.formState.isSubmitting}
                disabled={createTermMutation.isPending || termForm.formState.isSubmitting}
              >
                Save Payment Term
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 7. Create / Edit Quotation Template Modal */}
      <Dialog open={isTemplateModalOpen} onOpenChange={setIsTemplateModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingTemplateId ? "Edit Quotation Template" : "New Quotation Template"}</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={templateForm.handleSubmit((data) => saveTemplateMutation.mutate(data))}
            className="space-y-4 py-2"
            noValidate
          >
            <Input
              label="Template Name"
              required
              placeholder="e.g. Standard SaaS Bundle"
              error={templateForm.formState.errors.name?.message}
              {...templateForm.register("name")}
            />

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Associated Plan *</label>
              <select
                {...templateForm.register("plan_id", { valueAsNumber: true })}
                className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm bg-white"
              >
                {plansData?.items?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({formatCurrency(p.price)} / {p.billing_period})
                  </option>
                ))}
              </select>
            </div>

            <Input
              label="Validity (Days)"
              type="number"
              min="1"
              required
              placeholder="30"
              error={templateForm.formState.errors.validity_days?.message}
              {...templateForm.register("validity_days", { valueAsNumber: true })}
            />

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Payment Term *</label>
              <select
                {...templateForm.register("payment_term_id", { valueAsNumber: true })}
                className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm bg-white"
              >
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
                  {...templateForm.register("is_active")}
                  className="rounded text-indigo-600 focus:ring-indigo-500 h-4 w-4"
                />
                <span>Active Template</span>
              </label>
            </div>

            <DialogFooter>
              <Button variant="outline" type="button" onClick={() => setIsTemplateModalOpen(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                isLoading={saveTemplateMutation.isPending || templateForm.formState.isSubmitting}
                disabled={saveTemplateMutation.isPending || templateForm.formState.isSubmitting}
              >
                {editingTemplateId ? "Save Changes" : "Create Template"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
