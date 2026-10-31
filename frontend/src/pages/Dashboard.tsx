import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import { formatCurrency } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import {
  TrendingUp,
  DollarSign,
  AlertTriangle,
  Repeat,
  Download,
  Printer,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

interface SummaryData {
  active_subscriptions: number;
  mrr: number;
  total_invoiced: number;
  total_collected: number;
  total_outstanding: number;
  overdue_count: number;
  overdue_total: number;
  aging_buckets: {
    "1_30_days": number;
    "31_60_days": number;
    "61_plus_days": number;
  };
}

export function Dashboard() {
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");

  const summaryQuery = useQuery<SummaryData>({
    queryKey: ["reports", "summary", dateFrom, dateTo],
    queryFn: () => {
      let url = "/reports/summary";
      const params = new URLSearchParams();
      if (dateFrom) params.set("date_from", dateFrom);
      if (dateTo) params.set("date_to", dateTo);
      if (params.toString()) url += `?${params.toString()}`;
      return api.get(url);
    },
    staleTime: 15000,
  });

  const revenueQuery = useQuery<Array<{ month: string; amount: number }>>({
    queryKey: ["reports", "revenue-by-month"],
    queryFn: () => api.get("/reports/revenue-by-month"),
    staleTime: 30000,
  });

  const mrrMovementQuery = useQuery<{
    new_mrr: number;
    expansion_mrr: number;
    contraction_mrr: number;
    churned_mrr: number;
    net_mrr: number;
  }>({
    queryKey: ["reports", "mrr-movement"],
    queryFn: () => api.get("/reports/mrr-movement"),
    staleTime: 30000,
  });

  const summary = summaryQuery.data;
  const revenueData = revenueQuery.data || [];
  const mrrMovement = mrrMovementQuery.data;

  const agingData = summary
    ? [
        { name: "1-30 Days", amount: summary.aging_buckets["1_30_days"] },
        { name: "31-60 Days", amount: summary.aging_buckets["31_60_days"] },
        { name: "61+ Days", amount: summary.aging_buckets["61_plus_days"] },
      ]
    : [];

  const handleExportCsv = (kind: "overdue" | "payments") => {
    window.open(`/api/reports/export/${kind}.csv`, "_blank");
  };

  return (
    <div className="space-y-6">
      {/* Top Header & Filter Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Finance & MRR Overview</h1>
          <p className="text-sm text-slate-500">Real-time subscription billing metrics and receivables aging</p>
        </div>

        <div className="flex flex-wrap items-center gap-2 no-print">
          <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-xs text-slate-600">
            <span className="text-slate-400">From:</span>
            <input
              type="date"
              aria-label="Start date filter"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="bg-transparent text-xs focus:outline-none"
            />
            <span className="text-slate-400">To:</span>
            <input
              type="date"
              aria-label="End date filter"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="bg-transparent text-xs focus:outline-none"
            />
            {(dateFrom || dateTo) && (
              <button
                type="button"
                onClick={() => {
                  setDateFrom("");
                  setDateTo("");
                }}
                className="ml-1 text-slate-400 hover:text-slate-600 font-semibold"
                aria-label="Clear date filters"
              >
                ✕
              </button>
            )}
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => handleExportCsv("overdue")}
            className="text-slate-700"
          >
            <Download className="h-4 w-4 mr-1.5" />
            Overdue CSV
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => handleExportCsv("payments")}
            className="text-slate-700"
          >
            <Download className="h-4 w-4 mr-1.5" />
            Payments CSV
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => window.print()}
            className="text-slate-700"
          >
            <Printer className="h-4 w-4 mr-1.5" />
            Print Report
          </Button>
        </div>
      </div>

      {/* KPI Cards Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Active Subscriptions */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-600">Active Subscriptions</CardTitle>
            <div className="p-2 rounded-lg bg-indigo-50 text-indigo-600">
              <Repeat className="h-5 w-5" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-slate-900">
              {summary ? summary.active_subscriptions : "..."}
            </div>
            <p className="text-xs text-slate-500 mt-1">Contracts currently generating revenue</p>
          </CardContent>
        </Card>

        {/* Normalized MRR */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-600">Monthly Recurring Revenue (MRR)</CardTitle>
            <div className="p-2 rounded-lg bg-emerald-50 text-emerald-600">
              <TrendingUp className="h-5 w-5" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-slate-900">
              {summary ? formatCurrency(summary.mrr) : "..."}
            </div>
            <p className="text-xs text-slate-500 mt-1">Normalized across daily, weekly, monthly & annual tiers</p>
          </CardContent>
        </Card>

        {/* Collected Revenue */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-600">Revenue Collected</CardTitle>
            <div className="p-2 rounded-lg bg-blue-50 text-blue-600">
              <DollarSign className="h-5 w-5" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-slate-900">
              {summary ? formatCurrency(summary.total_collected) : "..."}
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Outstanding: {summary ? formatCurrency(summary.total_outstanding) : "..."}
            </p>
          </CardContent>
        </Card>

        {/* Overdue Receivables */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-600">Overdue Balance</CardTitle>
            <div className="p-2 rounded-lg bg-rose-50 text-rose-600">
              <AlertTriangle className="h-5 w-5" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-rose-600">
              {summary ? formatCurrency(summary.overdue_total) : "..."}
            </div>
            <p className="text-xs text-rose-500 mt-1">
              {summary ? summary.overdue_count : 0} past due invoices
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Charts Section: Revenue Collection & Overdue Aging */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Monthly Revenue Trend Chart */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Revenue Collections (Last 6 Months)</CardTitle>
            <CardDescription>Monthly realized receipts across all active payment methods</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={revenueData} margin={{ top: 10, right: 10, left: 0, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="month" stroke="#64748b" fontSize={12} tickLine={false} />
                  <YAxis
                    stroke="#64748b"
                    fontSize={12}
                    tickLine={false}
                    tickFormatter={(val) => `₹${val >= 1000 ? `${(val / 1000).toFixed(0)}k` : val}`}
                  />
                  <Tooltip
                    formatter={(value: any) => [formatCurrency(Number(value)), "Revenue"]}
                    contentStyle={{ backgroundColor: "#ffffff", borderRadius: "8px", border: "1px solid #e2e8f0" }}
                  />
                  <Bar dataKey="amount" fill="#4f46e5" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Overdue Debt Aging Buckets */}
        <Card>
          <CardHeader>
            <CardTitle>Aging Buckets</CardTitle>
            <CardDescription>Accounts receivable aging distribution</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4 pt-2">
              {agingData.map((bucket, i) => {
                const totalDebt = summary?.overdue_total || 1;
                const percentage = Math.min(100, Math.round((bucket.amount / totalDebt) * 100));
                const colors = ["bg-amber-500", "bg-orange-500", "bg-rose-600"];

                return (
                  <div key={bucket.name} className="space-y-1.5">
                    <div className="flex justify-between text-sm">
                      <span className="font-medium text-slate-700">{bucket.name}</span>
                      <span className="font-semibold text-slate-900">{formatCurrency(bucket.amount)}</span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
                      <div
                        className={`h-2.5 rounded-full ${colors[i % colors.length]}`}
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                    <div className="text-right text-xs text-slate-400">{percentage}% of overdue debt</div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* MRR Movement Card (P2 Feature) */}
      {mrrMovement && (
        <Card>
          <CardHeader>
            <CardTitle>Current Month MRR Movement</CardTitle>
            <CardDescription>Net growth dynamics breaking down additions, expansions, contractions and churn</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="p-4 rounded-lg bg-emerald-50 border border-emerald-100">
                <div className="flex items-center text-xs font-semibold text-emerald-700 uppercase">
                  <ArrowUpRight className="h-4 w-4 mr-1" /> New MRR
                </div>
                <div className="text-xl font-bold text-emerald-900 mt-1">{formatCurrency(mrrMovement.new_mrr)}</div>
              </div>

              <div className="p-4 rounded-lg bg-blue-50 border border-blue-100">
                <div className="flex items-center text-xs font-semibold text-blue-700 uppercase">
                  <ArrowUpRight className="h-4 w-4 mr-1" /> Expansion MRR
                </div>
                <div className="text-xl font-bold text-blue-900 mt-1">{formatCurrency(mrrMovement.expansion_mrr)}</div>
              </div>

              <div className="p-4 rounded-lg bg-amber-50 border border-amber-100">
                <div className="flex items-center text-xs font-semibold text-amber-700 uppercase">
                  <ArrowDownRight className="h-4 w-4 mr-1" /> Contraction MRR
                </div>
                <div className="text-xl font-bold text-amber-900 mt-1">-{formatCurrency(mrrMovement.contraction_mrr)}</div>
              </div>

              <div className="p-4 rounded-lg bg-rose-50 border border-rose-100">
                <div className="flex items-center text-xs font-semibold text-rose-700 uppercase">
                  <ArrowDownRight className="h-4 w-4 mr-1" /> Churned MRR
                </div>
                <div className="text-xl font-bold text-rose-900 mt-1">-{formatCurrency(mrrMovement.churned_mrr)}</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
