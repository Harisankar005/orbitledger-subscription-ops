import React, { useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import {
  ArrowLeft,
  CheckCircle2,
  Play,
  Pause,
  XCircle,
  RotateCw,
  Edit3,
  Plus,
  Trash2,
  Save,
  X,
} from "lucide-react";

interface EditableLine {
  product_id: number;
  variant_id?: number | null;
  quantity: number;
  description?: string;
  unit_price?: number;
  tax_id?: number | null;
}

export function SubscriptionDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [isEditing, setIsEditing] = useState(false);
  const [editPlanId, setEditPlanId] = useState<number | "">("");
  const [editStartDate, setEditStartDate] = useState<string>("");
  const [editExpiryDate, setEditExpiryDate] = useState<string>("");
  const [editPaymentTermId, setEditPaymentTermId] = useState<number | "">("");
  const [editNotes, setEditNotes] = useState<string>("");
  const [editLines, setEditLines] = useState<EditableLine[]>([]);

  const subQuery = useQuery<any>({
    queryKey: ["subscriptions", id],
    queryFn: () => api.get(`/subscriptions/${id}`),
    enabled: !!id,
  });

  const isDraft = subQuery.data?.status === "draft";

  const plansQuery = useQuery<{ items: any[] }>({
    queryKey: ["plans"],
    queryFn: () => api.get("/plans"),
    enabled: isDraft,
  });

  const paymentTermsQuery = useQuery<{ items: any[] }>({
    queryKey: ["payment-terms"],
    queryFn: () => api.get("/payment-terms"),
    enabled: isDraft,
  });

  const productsQuery = useQuery<{ items: any[] }>({
    queryKey: ["products"],
    queryFn: () => api.get("/products?page_size=100"),
    enabled: isDraft,
  });

  const taxesQuery = useQuery<{ items: any[] }>({
    queryKey: ["taxes"],
    queryFn: () => api.get("/taxes"),
    enabled: isDraft,
  });

  const startEditing = () => {
    if (!subQuery.data) return;
    const sub = subQuery.data;
    setEditPlanId(sub.plan_id);
    setEditStartDate(sub.start_date);
    setEditExpiryDate(sub.expiry_date);
    setEditPaymentTermId(sub.payment_term_id);
    setEditNotes(sub.notes || "");
    setEditLines(
      (sub.lines || []).map((l: any) => ({
        product_id: l.product_id,
        variant_id: l.variant_id || null,
        quantity: l.quantity,
        description: l.description,
        unit_price: Number(l.unit_price),
        tax_id: l.tax_id || null,
      }))
    );
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setIsEditing(false);
  };

  const updateMutation = useMutation({
    mutationFn: (payload: any) => api.patch(`/subscriptions/${id}`, payload),
    onSuccess: () => {
      setIsEditing(false);
      queryClient.invalidateQueries({ queryKey: ["subscriptions", id] });
      queryClient.invalidateQueries({ queryKey: ["subscriptions"] });
    },
    onError: (err: any) => {
      alert(`Update Failed: ${err.message || "Failed to update draft subscription"}`);
    },
  });

  const handleSave = () => {
    if (editLines.length === 0) {
      alert("Subscription must have at least one product line.");
      return;
    }
    updateMutation.mutate({
      plan_id: Number(editPlanId),
      start_date: editStartDate,
      expiry_date: editExpiryDate,
      payment_term_id: Number(editPaymentTermId),
      notes: editNotes,
      lines: editLines.map((l) => ({
        product_id: Number(l.product_id),
        variant_id: l.variant_id ? Number(l.variant_id) : undefined,
        quantity: Number(l.quantity),
        description: l.description,
        unit_price: l.unit_price !== undefined ? Number(l.unit_price) : undefined,
        tax_id: l.tax_id ? Number(l.tax_id) : undefined,
      })),
    });
  };

  const handleAddLine = () => {
    const products = productsQuery.data?.items || [];
    if (products.length === 0) {
      alert("No products available to add.");
      return;
    }
    const first = products[0];
    const initialPrice = first.variants && first.variants.length > 0
      ? Number(first.list_price || 0) + Number(first.variants[0].price_extra || 0)
      : Number(first.list_price || 0);

    setEditLines([
      ...editLines,
      {
        product_id: first.id,
        variant_id: first.variants?.[0]?.id || null,
        quantity: 1,
        description: first.name,
        unit_price: initialPrice,
        tax_id: first.tax_id || null,
      },
    ]);
  };

  const handleRemoveLine = (idx: number) => {
    setEditLines(editLines.filter((_, i) => i !== idx));
  };

  const handleLineProductChange = (idx: number, productId: number) => {
    const products = productsQuery.data?.items || [];
    const prod = products.find((p) => p.id === productId);
    if (!prod) return;

    const variantId = prod.variants?.[0]?.id || null;
    const priceExtra = prod.variants?.[0]?.price_extra || 0;
    const unitPrice = Number(prod.list_price || 0) + Number(priceExtra);

    setEditLines(
      editLines.map((line, i) =>
        i === idx
          ? {
              ...line,
              product_id: prod.id,
              variant_id: variantId,
              description: prod.name,
              unit_price: unitPrice,
              tax_id: prod.tax_id || null,
            }
          : line
      )
    );
  };

  const handleLineVariantChange = (idx: number, variantId: number | null) => {
    setEditLines(
      editLines.map((line, i) => {
        if (i !== idx) return line;
        const products = productsQuery.data?.items || [];
        const prod = products.find((p) => p.id === line.product_id);
        const variant = prod?.variants?.find((v: any) => v.id === variantId);
        const unitPrice = Number(prod?.list_price || 0) + Number(variant?.price_extra || 0);
        return {
          ...line,
          variant_id: variantId,
          unit_price: unitPrice,
        };
      })
    );
  };

  const handleLineQuantityChange = (idx: number, qty: number) => {
    setEditLines(
      editLines.map((line, i) => (i === idx ? { ...line, quantity: Math.max(1, qty) } : line))
    );
  };

  const handleLinePriceChange = (idx: number, price: number) => {
    setEditLines(
      editLines.map((line, i) => (i === idx ? { ...line, unit_price: Math.max(0, price) } : line))
    );
  };

  const handleLineTaxChange = (idx: number, taxId: number | null) => {
    setEditLines(editLines.map((line, i) => (i === idx ? { ...line, tax_id: taxId } : line)));
  };

  const transitionMutation = useMutation({
    mutationFn: (data: { target_status: string; reason?: string; expected_version?: number }) =>
      api.post(`/subscriptions/${id}/transition`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["subscriptions", id] });
      queryClient.invalidateQueries({ queryKey: ["subscriptions"] });
    },
    onError: (err: any) => {
      alert(`Transition Failed: ${err.message || "Invalid state transition"}`);
    },
  });

  const renewMutation = useMutation({
    mutationFn: () => api.post(`/subscriptions/${id}/renew`),
    onSuccess: (newSub: any) => {
      alert(`Subscription renewed successfully as ${newSub.number}!`);
      navigate(`/subscriptions/${newSub.id}`);
    },
    onError: (err: any) => {
      alert(`Renewal Failed: ${err.message || "Plan does not allow renewals"}`);
    },
  });

  if (subQuery.isLoading) {
    return <div className="p-8 text-center text-slate-500">Loading subscription details...</div>;
  }

  const sub = subQuery.data;
  if (!sub) {
    return <div className="p-8 text-center text-slate-500">Subscription not found</div>;
  }

  const steps = ["draft", "quotation", "confirmed", "active", "closed"];
  const currentStepIdx = steps.indexOf(sub.status === "paused" ? "active" : sub.status);

  return (
    <div className="space-y-6">
      {/* Top Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center space-x-3">
          <Link to="/subscriptions" className="p-2 rounded-lg hover:bg-slate-200 transition-colors">
            <ArrowLeft className="h-5 w-5 text-slate-600" />
          </Link>
          <div>
            <div className="flex items-center space-x-3">
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">{sub.number}</h1>
              <Badge status={sub.status} />
              {sub.status === "paused" && (
                <span className="text-xs bg-amber-100 text-amber-800 font-medium px-2 py-0.5 rounded">
                  Paused
                </span>
              )}
            </div>
            <p className="text-sm text-slate-500">Customer: {sub.customer?.name} ({sub.customer?.company || "Individual"})</p>
          </div>
        </div>

        {/* Legal Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {sub.status === "draft" && !isEditing && (
            <>
              <Button variant="outline" onClick={startEditing}>
                <Edit3 className="h-4 w-4 mr-1.5" />
                Edit Draft
              </Button>
              <Button
                onClick={() =>
                  transitionMutation.mutate({
                    target_status: "quotation",
                    expected_version: sub.version,
                  })
                }
                isLoading={transitionMutation.isPending}
              >
                Generate Quotation
              </Button>
            </>
          )}

          {sub.status === "draft" && isEditing && (
            <>
              <Button variant="outline" onClick={cancelEditing} disabled={updateMutation.isPending}>
                <X className="h-4 w-4 mr-1.5" />
                Cancel
              </Button>
              <Button onClick={handleSave} isLoading={updateMutation.isPending}>
                <Save className="h-4 w-4 mr-1.5" />
                Save Changes
              </Button>
            </>
          )}

          {sub.status === "quotation" && (
            <>
              <Button
                variant="outline"
                onClick={() =>
                  transitionMutation.mutate({
                    target_status: "draft",
                    reason: "Quotation revised",
                    expected_version: sub.version,
                  })
                }
              >
                Revise to Draft
              </Button>
              <Button
                onClick={() =>
                  transitionMutation.mutate({
                    target_status: "confirmed",
                    expected_version: sub.version,
                  })
                }
                isLoading={transitionMutation.isPending}
              >
                Confirm Contract
              </Button>
            </>
          )}

          {sub.status === "confirmed" && (
            <Button
              onClick={() =>
                transitionMutation.mutate({
                  target_status: "active",
                  reason: "Manual activation",
                  expected_version: sub.version,
                })
              }
              isLoading={transitionMutation.isPending}
            >
              <Play className="h-4 w-4 mr-1.5" />
              Activate Contract
            </Button>
          )}

          {sub.status === "active" && (
            <>
              {sub.plan?.allow_pause && (
                <Button
                  variant="outline"
                  onClick={() =>
                    transitionMutation.mutate({
                      target_status: "paused",
                      reason: "Client request",
                      expected_version: sub.version,
                    })
                  }
                  isLoading={transitionMutation.isPending}
                >
                  <Pause className="h-4 w-4 mr-1.5" />
                  Pause
                </Button>
              )}
              {sub.plan?.allow_early_close && (
                <Button
                  variant="danger"
                  onClick={() => {
                    if (confirm("Are you sure you want to close this subscription early?")) {
                      transitionMutation.mutate({
                        target_status: "closed",
                        reason: "Early client termination",
                        expected_version: sub.version,
                      });
                    }
                  }}
                  isLoading={transitionMutation.isPending}
                >
                  <XCircle className="h-4 w-4 mr-1.5" />
                  Close Early
                </Button>
              )}
            </>
          )}

          {sub.status === "paused" && (
            <>
              <Button
                onClick={() =>
                  transitionMutation.mutate({
                    target_status: "active",
                    reason: "Resumed from pause",
                    expected_version: sub.version,
                  })
                }
                isLoading={transitionMutation.isPending}
              >
                <Play className="h-4 w-4 mr-1.5" />
                Resume Contract
              </Button>
              <Button
                variant="danger"
                onClick={() =>
                  transitionMutation.mutate({
                    target_status: "closed",
                    reason: "Closed while paused",
                    expected_version: sub.version,
                  })
                }
                isLoading={transitionMutation.isPending}
              >
                Close Contract
              </Button>
            </>
          )}

          {sub.status === "closed" && sub.plan?.allow_renew && (
            <Button onClick={() => renewMutation.mutate()} isLoading={renewMutation.isPending}>
              <RotateCw className="h-4 w-4 mr-1.5" />
              Renew Contract
            </Button>
          )}
        </div>
      </div>

      {/* Visual Stepper */}
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-between w-full">
            {steps.map((step, idx) => {
              const isPast = currentStepIdx >= idx;
              const isCurrent = sub.status === step || (sub.status === "paused" && step === "active");

              return (
                <div key={step} className="flex-1 flex items-center">
                  <div className="flex flex-col items-center flex-1">
                    <div
                      className={`h-9 w-9 rounded-full flex items-center justify-center font-bold text-xs transition-colors ${
                        isCurrent
                          ? "bg-indigo-600 text-white ring-4 ring-indigo-100"
                          : isPast
                          ? "bg-emerald-600 text-white"
                          : "bg-slate-100 text-slate-400 border border-slate-200"
                      }`}
                    >
                      {isPast && !isCurrent ? <CheckCircle2 className="h-5 w-5" /> : idx + 1}
                    </div>
                    <span className="text-xs font-semibold uppercase mt-2 capitalize text-slate-700">
                      {step}
                    </span>
                  </div>
                  {idx < steps.length - 1 && (
                    <div
                      className={`h-1 flex-1 transition-colors ${
                        currentStepIdx > idx ? "bg-emerald-500" : "bg-slate-200"
                      }`}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Contract Details and Dates */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-slate-500 uppercase tracking-wider">Plan & Pricing</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {isEditing ? (
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Subscription Plan</label>
                <select
                  className="w-full h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm"
                  value={editPlanId}
                  onChange={(e) => setEditPlanId(Number(e.target.value))}
                >
                  {plansQuery.data?.items?.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({formatCurrency(p.price, sub.currency)} / {p.billing_period})
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <>
                <div>
                  <div className="text-lg font-bold text-slate-900">{sub.plan?.name}</div>
                  <div className="text-xs text-slate-500 capitalize">{sub.plan?.billing_period} Billing Tier</div>
                </div>
                <div className="pt-2 border-t border-slate-100 flex justify-between">
                  <span className="text-sm text-slate-600">Base Recurring Fee:</span>
                  <span className="text-sm font-semibold text-slate-900">
                    {formatCurrency(sub.plan?.price || 0, sub.currency)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-slate-600">Min Line Quantity:</span>
                  <span className="text-sm font-semibold text-slate-900">{sub.plan?.min_quantity || 0}</span>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-slate-500 uppercase tracking-wider">Schedule & Timeline</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {isEditing ? (
              <div className="space-y-3">
                <Input
                  label="Start Date"
                  type="date"
                  value={editStartDate}
                  onChange={(e) => setEditStartDate(e.target.value)}
                />
                <Input
                  label="Expiry Date"
                  type="date"
                  value={editExpiryDate}
                  onChange={(e) => setEditExpiryDate(e.target.value)}
                />
              </div>
            ) : (
              <>
                <div className="flex justify-between">
                  <span className="text-slate-600">Start Date:</span>
                  <span className="font-medium text-slate-900">{formatDate(sub.start_date)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">Expiry Date:</span>
                  <span className="font-medium text-slate-900">{formatDate(sub.expiry_date)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">Billing Anchor:</span>
                  <span className="font-medium text-slate-900">{formatDate(sub.billing_anchor)}</span>
                </div>
                <div className="flex justify-between pt-1 border-t border-slate-100">
                  <span className="text-slate-600">Next Invoice Date:</span>
                  <span className="font-semibold text-indigo-600">{formatDate(sub.next_invoice_date)}</span>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-slate-500 uppercase tracking-wider">Billing Terms</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {isEditing ? (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Payment Term</label>
                  <select
                    className="w-full h-10 px-3 rounded-lg border border-slate-300 bg-white text-sm"
                    value={editPaymentTermId}
                    onChange={(e) => setEditPaymentTermId(Number(e.target.value))}
                  >
                    {paymentTermsQuery.data?.items?.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.days} days)
                      </option>
                    ))}
                  </select>
                </div>
                <Input
                  label="Notes"
                  placeholder="Additional terms or notes..."
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                />
              </div>
            ) : (
              <>
                <div className="flex justify-between">
                  <span className="text-slate-600">Periods Billed:</span>
                  <span className="font-semibold text-slate-900">{sub.periods_billed}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">Payment Term:</span>
                  <span className="font-medium text-slate-900">{sub.payment_term?.name || "Immediate"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">Currency:</span>
                  <span className="font-semibold text-slate-900">{sub.currency}</span>
                </div>
                {sub.notes && (
                  <div className="pt-2 border-t border-slate-100 text-xs text-slate-500">
                    <span className="font-semibold text-slate-700">Notes:</span> {sub.notes}
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Subscription Lines Table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Configured Products & Add-ons</CardTitle>
            <CardDescription>
              {isEditing
                ? "Modify line items, quantities, and price overrides"
                : "Line items snapshot with price and resolved taxes at addition time"}
            </CardDescription>
          </div>
          {sub.status === "draft" && !isEditing && (
            <Button variant="outline" size="sm" onClick={startEditing}>
              <Edit3 className="h-4 w-4 mr-1.5" />
              Edit Lines
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {isEditing ? (
            <div className="space-y-4">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-slate-500 uppercase text-xs border-b border-slate-200">
                    <tr>
                      <th className="px-3 py-2 w-1/3">Product</th>
                      <th className="px-3 py-2 w-1/4">Variant</th>
                      <th className="px-3 py-2 text-center w-20">Qty</th>
                      <th className="px-3 py-2 text-right w-28">Unit Price</th>
                      <th className="px-3 py-2 text-right w-36">Tax</th>
                      <th className="px-3 py-2 text-center w-12"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {editLines.map((line, idx) => {
                      const products = productsQuery.data?.items || [];
                      const prod = products.find((p) => p.id === line.product_id);
                      const variants = prod?.variants || [];

                      return (
                        <tr key={idx} className="hover:bg-slate-50">
                          <td className="px-3 py-2">
                            <select
                              className="w-full h-9 px-2 rounded border border-slate-300 text-sm"
                              value={line.product_id}
                              onChange={(e) => handleLineProductChange(idx, Number(e.target.value))}
                            >
                              {products.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.name}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            {variants.length > 0 ? (
                              <select
                                className="w-full h-9 px-2 rounded border border-slate-300 text-sm"
                                value={line.variant_id || ""}
                                onChange={(e) =>
                                  handleLineVariantChange(
                                    idx,
                                    e.target.value ? Number(e.target.value) : null
                                  )
                                }
                              >
                                {variants.map((v: any) => (
                                  <option key={v.id} value={v.id}>
                                    {v.name} (+{formatCurrency(v.price_extra, sub.currency)})
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <span className="text-xs text-slate-400 italic">No variants</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-center">
                            <input
                              type="number"
                              min="1"
                              className="w-16 h-9 px-2 text-center rounded border border-slate-300 text-sm"
                              value={line.quantity}
                              onChange={(e) => handleLineQuantityChange(idx, parseInt(e.target.value, 10) || 1)}
                            />
                          </td>
                          <td className="px-3 py-2 text-right">
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              className="w-24 h-9 px-2 text-right rounded border border-slate-300 text-sm"
                              value={line.unit_price ?? 0}
                              onChange={(e) => handleLinePriceChange(idx, parseFloat(e.target.value) || 0)}
                            />
                          </td>
                          <td className="px-3 py-2 text-right">
                            <select
                              className="w-full h-9 px-2 rounded border border-slate-300 text-sm"
                              value={line.tax_id || ""}
                              onChange={(e) =>
                                handleLineTaxChange(idx, e.target.value ? Number(e.target.value) : null)
                              }
                            >
                              <option value="">Exempt (0%)</option>
                              {taxesQuery.data?.items?.map((t) => (
                                <option key={t.id} value={t.id}>
                                  {t.name} ({t.rate}%)
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-3 py-2 text-center">
                            <button
                              type="button"
                              onClick={() => handleRemoveLine(idx)}
                              className="text-slate-400 hover:text-rose-600 transition-colors p-1"
                              title="Remove item"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between pt-2">
                <Button type="button" variant="outline" size="sm" onClick={handleAddLine}>
                  <Plus className="h-4 w-4 mr-1.5" />
                  Add Line Item
                </Button>
                <div className="flex items-center space-x-2">
                  <Button variant="outline" size="sm" onClick={cancelEditing}>
                    Cancel
                  </Button>
                  <Button size="sm" onClick={handleSave} isLoading={updateMutation.isPending}>
                    Save Changes
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-slate-500 uppercase text-xs border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3">Description</th>
                    <th className="px-4 py-3 text-center">Quantity</th>
                    <th className="px-4 py-3 text-right">Unit Price (Snapshot)</th>
                    <th className="px-4 py-3 text-right">Resolved Tax</th>
                    <th className="px-4 py-3 text-right">Line Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sub.lines?.map((line: any) => (
                    <tr key={line.id}>
                      <td className="px-4 py-3 font-medium text-slate-900">{line.description}</td>
                      <td className="px-4 py-3 text-center">{line.quantity}</td>
                      <td className="px-4 py-3 text-right">{formatCurrency(line.unit_price, sub.currency)}</td>
                      <td className="px-4 py-3 text-right">
                        {line.tax ? `${line.tax.name} (${line.tax.rate}%)` : "Tax Exempt"}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-slate-900">
                        {formatCurrency(line.amount, sub.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Status History Timeline */}
      <Card>
        <CardHeader>
          <CardTitle>Audit History Timeline</CardTitle>
          <CardDescription>Immutable record of every lifecycle state transition</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {sub.status_history?.map((h: any) => (
              <div key={h.id} className="flex items-start space-x-3 text-sm">
                <div className="h-2 w-2 rounded-full bg-indigo-600 mt-2" />
                <div className="flex-1">
                  <div className="flex items-center space-x-2">
                    <span className="font-semibold text-slate-900 uppercase text-xs">
                      {h.from_status} → {h.to_status}
                    </span>
                    <span className="text-xs text-slate-400">• {new Date(h.changed_at).toLocaleString()}</span>
                  </div>
                  {h.reason && <p className="text-xs text-slate-500 mt-0.5">{h.reason}</p>}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
