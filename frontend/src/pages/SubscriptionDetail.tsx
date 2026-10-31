import React, { useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  Play,
  Pause,
  XCircle,
  RotateCw,
  FileText,
  AlertCircle,
  Calendar,
  Layers,
} from "lucide-react";

export function SubscriptionDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const subQuery = useQuery<any>({
    queryKey: ["subscriptions", id],
    queryFn: () => api.get(`/subscriptions/${id}`),
    enabled: !!id,
  });

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

        {/* Legal Action Buttons (PLAN.md 5.3 & P5) */}
        <div className="flex flex-wrap items-center gap-2">
          {sub.status === "draft" && (
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
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-slate-500 uppercase tracking-wider">Schedule & Timeline</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
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
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-slate-500 uppercase tracking-wider">Billing Status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
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
          </CardContent>
        </Card>
      </div>

      {/* Subscription Lines Table */}
      <Card>
        <CardHeader>
          <CardTitle>Configured Products & Add-ons</CardTitle>
          <CardDescription>Line items snapshot with price and resolved taxes at addition time</CardDescription>
        </CardHeader>
        <CardContent>
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
            {sub.status_history?.map((h: any, i: number) => (
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
