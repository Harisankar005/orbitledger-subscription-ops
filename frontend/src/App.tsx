import React, { Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate, Outlet } from "react-router-dom";
import { useAuth } from "@/features/auth/AuthContext";
import { Shell } from "@/components/layout/Shell";
import { PortalShell } from "@/components/layout/PortalShell";
import { ToastProvider } from "@/context/ToastContext";

// Route-level code splitting via React.lazy
const Login = React.lazy(() => import("@/pages/Login").then((m) => ({ default: m.Login })));
const Register = React.lazy(() => import("@/pages/Register").then((m) => ({ default: m.Register })));
const ForgotPassword = React.lazy(() => import("@/pages/ForgotPassword").then((m) => ({ default: m.ForgotPassword })));
const ResetPassword = React.lazy(() => import("@/pages/ResetPassword").then((m) => ({ default: m.ResetPassword })));

const Dashboard = React.lazy(() => import("@/pages/Dashboard").then((m) => ({ default: m.Dashboard })));
const Subscriptions = React.lazy(() => import("@/pages/Subscriptions").then((m) => ({ default: m.Subscriptions })));
const SubscriptionDetail = React.lazy(() => import("@/pages/SubscriptionDetail").then((m) => ({ default: m.SubscriptionDetail })));
const Invoices = React.lazy(() => import("@/pages/Invoices").then((m) => ({ default: m.Invoices })));
const InvoiceDetail = React.lazy(() => import("@/pages/InvoiceDetail").then((m) => ({ default: m.InvoiceDetail })));
const Payments = React.lazy(() => import("@/pages/Payments").then((m) => ({ default: m.Payments })));
const Customers = React.lazy(() => import("@/pages/Customers").then((m) => ({ default: m.Customers })));
const Billing = React.lazy(() => import("@/pages/Billing").then((m) => ({ default: m.Billing })));
const Catalog = React.lazy(() => import("@/pages/Catalog").then((m) => ({ default: m.Catalog })));
const Discounts = React.lazy(() => import("@/pages/Discounts").then((m) => ({ default: m.Discounts })));

const Users = React.lazy(() => import("@/pages/Users").then((m) => ({ default: m.Users })));
const AuditLog = React.lazy(() => import("@/pages/AuditLog").then((m) => ({ default: m.AuditLog })));
const Outbox = React.lazy(() => import("@/pages/Outbox").then((m) => ({ default: m.Outbox })));

const PortalSubscriptions = React.lazy(() => import("@/pages/portal/PortalSubscriptions").then((m) => ({ default: m.PortalSubscriptions })));
const PortalInvoices = React.lazy(() => import("@/pages/portal/PortalInvoices").then((m) => ({ default: m.PortalInvoices })));
const PortalProfile = React.lazy(() => import("@/pages/portal/PortalProfile").then((m) => ({ default: m.PortalProfile })));

function LoadingScreen() {
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center">
      <div className="h-10 w-10 rounded-xl bg-indigo-600 flex items-center justify-center text-white font-bold text-xl mb-4 animate-pulse">
        B
      </div>
      <div className="text-sm font-medium text-slate-600">Loading workspace...</div>
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
      <ToastProvider>
        <Suspense fallback={<LoadingScreen />}>
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
        </Suspense>
      </ToastProvider>
    </BrowserRouter>
  );
}

export default App;
