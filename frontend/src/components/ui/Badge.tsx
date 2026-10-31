import React from "react";
import { cn } from "@/lib/utils";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "success" | "warning" | "danger" | "info" | "neutral" | "outline" | "destructive";
  status?: string;
}

export function Badge({ className, variant = "default", status, children, ...props }: BadgeProps) {
  let computedVariant = variant;

  if (computedVariant === "destructive") computedVariant = "danger";

  if (status) {
    const s = status.toLowerCase();
    if (["active", "paid"].includes(s)) computedVariant = "success";
    else if (["quotation", "confirmed", "scheduled", "outstanding"].includes(s)) computedVariant = "info";
    else if (["paused", "partially paid", "partially_paid", "exhausted"].includes(s)) computedVariant = "warning";
    else if (["closed", "overdue", "cancelled", "danger"].includes(s)) computedVariant = "danger";
    else computedVariant = "neutral";
  }

  const variantStyles: Record<string, string> = {
    default: "bg-indigo-50 text-indigo-700 border-indigo-200",
    success: "bg-emerald-50 text-emerald-700 border-emerald-200",
    warning: "bg-amber-50 text-amber-700 border-amber-200",
    danger: "bg-rose-50 text-rose-700 border-rose-200",
    info: "bg-blue-50 text-blue-700 border-blue-200",
    neutral: "bg-slate-100 text-slate-700 border-slate-200",
    outline: "bg-transparent text-slate-700 border-slate-300",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border capitalize",
        variantStyles[computedVariant] || variantStyles.neutral,
        className
      )}
      {...props}
    >
      {children || status}
    </span>
  );
}
