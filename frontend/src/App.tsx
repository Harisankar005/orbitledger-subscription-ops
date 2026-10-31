import React from "react";
import { BrowserRouter, Routes, Route, Navigate, Outlet } from "react-router-dom";
import { useAuth } from "@/features/auth/AuthContext";
import { Shell } from "@/components/layout/Shell";
import { PortalShell } from "@/components/layout/PortalShell";

// Auth Pages
import { Login } from "@/pages/Login";
import { Register } from "@/pages/Register";
import { ForgotPassword } from "@/pages/ForgotPassword";
import { ResetPassword } from "@/pages/ResetPassword";

// Admin / Staff Operations Pages
import { Dashboard } from "@/pages/Dashboard";
import { Subscriptions } from "@/pages/Subscriptions";
import { SubscriptionDetail } from "@/pages/SubscriptionDetail";
import { Invoices } from "@/pages/Invoices";
import { InvoiceDetail } from "@/pages/InvoiceDetail";
import { Payments } from "@/pages/Payments";
import { Customers } from "@/pages/Customers";
import { Billing } from "@/pages/Billing";
import { Catalog } from "@/pages/Catalog";
import { Discounts } from "@/pages/Discounts";

// Platform Admin Pages
import { Users } from "@/pages/Users";
import { AuditLog } from "@/pages/AuditLog";
import { Outbox } from "@/pages/Outbox";

// Customer Portal Pages
import { PortalSubscriptions } from "@/pages/portal/PortalSubscriptions";
import { PortalInvoices } from "@/pages/portal/PortalInvoices";
import { PortalProfile } from "@/pages/portal/PortalProfile";

function LoadingScreen() {
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center">
      <div className="h-10 w-10 rounded-xl bg-indigo-600 flex items-center justify-center text-white font-bold text-xl mb-4 animate-pulse">
        B
      </div>
      <div className="text-sm font-medium text-slate-600">Initializing Brightloop...</div>
    </div>
  );
}

// Protected Route Guard
function ProtectedRoute({ allowedRoles }: { allowedRoles?: string[] }) {
  const { user, isLoading, hasRole } = useAuth();

  if (isLoading) {
    return <LoadingScreen />;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles && !hasRole(...allowedRoles)) {
    if (user.role === "customer") {
      return <Navigate to="/portal" replace />;
    }
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}

// Redirects already authenticated users away from /login or /register
function PublicOnlyRoute() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return <LoadingScreen />;
  }

  if (user) {
    if (user.role === "customer") {
      return <Navigate to="/portal" replace />;
    }
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public / Auth routes */}
        <Route element={<PublicOnlyRoute />}>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
        </Route>

        {/* Customer Portal routes */}
        <Route element={<ProtectedRoute allowedRoles={["customer", "admin", "staff"]} />}>
          <Route path="/portal" element={<PortalShell />}>
            <Route index element={<PortalSubscriptions />} />
            <Route path="invoices" element={<PortalInvoices />} />
            <Route path="profile" element={<PortalProfile />} />
          </Route>
        </Route>

        {/* Admin and Staff Operations routes */}
        <Route element={<ProtectedRoute allowedRoles={["admin", "staff"]} />}>
          <Route element={<Shell />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/subscriptions" element={<Subscriptions />} />
            <Route path="/subscriptions/:id" element={<SubscriptionDetail />} />
            <Route path="/invoices" element={<Invoices />} />
            <Route path="/invoices/:id" element={<InvoiceDetail />} />
            <Route path="/payments" element={<Payments />} />
            <Route path="/customers" element={<Customers />} />
            <Route path="/billing" element={<Billing />} />
            <Route path="/catalog" element={<Catalog />} />
            <Route path="/discounts" element={<Discounts />} />

            {/* Admin-only subroutes */}
            <Route element={<ProtectedRoute allowedRoles={["admin"]} />}>
              <Route path="/users" element={<Users />} />
              <Route path="/audit-log" element={<AuditLog />} />
              <Route path="/outbox" element={<Outbox />} />
            </Route>
          </Route>
        </Route>

        {/* Catch-all redirect */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
export default App;
