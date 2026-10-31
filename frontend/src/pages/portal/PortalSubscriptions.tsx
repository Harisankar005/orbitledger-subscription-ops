import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/Dialog";
import { Repeat, Pause, Play, XCircle } from "lucide-react";

interface PortalSubscription {
  id: number;
  number: string;
  status: "draft" | "quotation" | "confirmed" | "active" | "paused" | "closed";
  start_date?: string;
  expiry_date?: string;
  next_invoice_date?: string;
  currency: string;
  plan?: {
    id: number;
    name: string;
    price: number;
    billing_period: string;
    allow_pause: boolean;
    allow_early_close: boolean;
  };
  lines: Array<{
    id: number;
    description: string;
    quantity: number;
    unit_price: number;
    amount: number;
  }>;
  version: number;
}

export function PortalSubscriptions() {
  const queryClient = useQueryClient();
  const [transitioningSub, setTransitioningSub] = useState<PortalSubscription | null>(null);
  const [targetStatus, setTargetStatus] = useState<"paused" | "active" | "closed" | null>(null);
  const [reason, setReason] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["portal-subscriptions"],
    queryFn: () => api.get<{ items: PortalSubscription[]; total: number }>("/portal/subscriptions"),
  });

  const transitionMutation = useMutation({
    mutationFn: () => {
      if (!transitioningSub || !targetStatus) return Promise.reject("Invalid request");
      return api.post(`/portal/subscriptions/${transitioningSub.id}/transition`, {
        target_status: targetStatus,
        reason: reason || undefined,
        expected_version: transitioningSub.version,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["portal-subscriptions"] });
      setTransitioningSub(null);
      setTargetStatus(null);
      setReason("");
    },
    onError: (err: any) => {
      setErrorMessage(err.message || "Failed to update subscription status");
    },
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "active":
        return <Badge variant="success">Active</Badge>;
      case "paused":
        return <Badge variant="warning">Paused</Badge>;
      case "closed":
        return <Badge variant="neutral">Closed</Badge>;
      default:
        return <Badge variant="info">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">My Subscriptions</h1>
        <p className="text-sm text-slate-500 mt-1">
          Review your active recurring services, bill cycles, and self-service controls.
        </p>
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-slate-400">Loading subscriptions...</div>
      ) : !data || data.items.length === 0 ? (
        <Card className="p-8 text-center bg-white border border-slate-200">
          <Repeat className="h-10 w-10 text-slate-300 mx-auto mb-3" />
          <h3 className="text-base font-semibold text-slate-800">No active subscriptions</h3>
          <p className="text-xs text-slate-500 mt-1">
            You do not have any active subscriptions registered with this account.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-6">
          {data.items.map((sub) => (
            <Card key={sub.id} className="p-6 bg-white border border-slate-200">
              <div className="flex flex-col md:flex-row md:items-center justify-between pb-4 border-b border-slate-100 gap-4">
                <div>
                  <div className="flex items-center space-x-3">
                    <span className="text-lg font-bold text-slate-900 font-mono">
                      {sub.number}
                    </span>
                    {getStatusBadge(sub.status)}
                  </div>
                  <div className="text-sm font-semibold text-indigo-600 mt-1">
                    {sub.plan?.name || "Standard Plan"}
                  </div>
                </div>

                {/* Self Service Actions */}
                <div className="flex items-center space-x-2">
                  {sub.status === "active" && sub.plan?.allow_pause && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setTransitioningSub(sub);
                        setTargetStatus("paused");
                        setReason("");
                        setErrorMessage("");
                      }}
                    >
                      <Pause className="h-3.5 w-3.5 mr-1" />
                      Pause
                    </Button>
                  )}

                  {sub.status === "paused" && (
                    <Button
                      size="sm"
                      onClick={() => {
                        setTransitioningSub(sub);
                        setTargetStatus("active");
                        setReason("");
                        setErrorMessage("");
                      }}
                    >
                      <Play className="h-3.5 w-3.5 mr-1" />
                      Resume
                    </Button>
                  )}

                  {(sub.status === "active" || sub.status === "paused") &&
                    sub.plan?.allow_early_close && (
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => {
                          setTransitioningSub(sub);
                          setTargetStatus("closed");
                          setReason("");
                          setErrorMessage("");
                        }}
                      >
                        <XCircle className="h-3.5 w-3.5 mr-1" />
                        Cancel
                      </Button>
                    )}
                </div>
              </div>

              {/* Subscription Timeline & Meta */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 py-4 text-xs text-slate-600">
                <div>
                  <span className="text-slate-400 block mb-0.5">Start Date</span>
                  <span className="font-semibold text-slate-800">
                    {sub.start_date ? formatDate(sub.start_date) : "Immediate"}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block mb-0.5">Expiry / End Date</span>
                  <span className="font-semibold text-slate-800">
                    {sub.expiry_date ? formatDate(sub.expiry_date) : "Auto-renewing"}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block mb-0.5">Next Invoice Date</span>
                  <span className="font-semibold text-indigo-600">
                    {sub.next_invoice_date ? formatDate(sub.next_invoice_date) : "N/A"}
                  </span>
                </div>
              </div>

              {/* Line Items Breakdown */}
              {sub.lines && sub.lines.length > 0 && (
                <div className="mt-4 pt-4 border-t border-slate-100">
                  <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                    Included Items & Seats
                  </h4>
                  <div className="divide-y divide-slate-100">
                    {sub.lines.map((line) => (
                      <div key={line.id} className="py-2 flex items-center justify-between text-xs">
                        <span className="text-slate-800 font-medium">
                          {line.description} (x{line.quantity})
                        </span>
                        <span className="font-mono text-slate-900 font-semibold">
                          {formatCurrency(line.amount, sub.currency)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* Confirmation Modal */}
      <Dialog open={!!targetStatus} onOpenChange={(open) => !open && setTargetStatus(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="capitalize">Confirm {targetStatus} Subscription</DialogTitle>
          </DialogHeader>

          {errorMessage && (
            <div className="p-3 text-xs bg-rose-50 text-rose-700 rounded-lg border border-rose-200">
              {errorMessage}
            </div>
          )}

          <div className="space-y-3 py-2 text-sm text-slate-600">
            <p>
              Are you sure you want to transition subscription{" "}
              <strong className="text-slate-900 font-mono">{transitioningSub?.number}</strong> to{" "}
              <strong className="text-slate-900 capitalize">{targetStatus}</strong>?
            </p>
            {targetStatus === "closed" && (
              <p className="text-xs text-rose-600">
                Closure takes effect immediately. Future recurring billing cycles will cease.
              </p>
            )}
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Reason (Optional)
              </label>
              <input
                type="text"
                className="w-full h-10 px-3 rounded-lg border border-slate-300 text-sm"
                placeholder="Let us know why you are changing status"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setTargetStatus(null)}>
              Keep Unchanged
            </Button>
            <Button
              variant={targetStatus === "closed" ? "destructive" : "primary"}
              disabled={transitionMutation.isPending}
              onClick={() => transitionMutation.mutate()}
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
