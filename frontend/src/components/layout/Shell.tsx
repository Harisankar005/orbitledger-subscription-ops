import React, { useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "@/features/auth/AuthContext";
import { api } from "@/api/client";
import { useToast } from "@/context/ToastContext";
import { LiveIndicator } from "@/components/ui/LiveIndicator";
import { Button } from "@/components/ui/Button";
import {
  LayoutDashboard,
  Repeat,
  FileText,
  CreditCard,
  Users,
  Zap,
  Tag,
  Shield,
  History,
  Mail,
  Menu,
  X,
  FastForward,
  LogOut,
  Package,
} from "lucide-react";

export function Shell() {
  const { user, logout, hasRole } = useAuth();
  const toast = useToast();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [timeTraveling, setTimeTraveling] = useState(false);
  const navigate = useNavigate();

  const handleTimeTravel = async () => {
    setTimeTraveling(true);
    try {
      const res = await api.post<{ new_date: string; billing_result: { created: number } }>("/demo/advance-clock", {
        months: 1,
      });
      toast.success(`Simulated date advanced to ${res.new_date}! Billing engine generated ${res.billing_result.created} invoices.`);
      window.location.reload();
    } catch (err: any) {
      toast.error(`Time-travel error: ${err.message || "Failed"}`);
    } finally {
      setTimeTraveling(false);
    }
  };

  const navItems = [
    { label: "Dashboard", to: "/", icon: LayoutDashboard },
    { label: "Subscriptions", to: "/subscriptions", icon: Repeat },
    { label: "Invoices", to: "/invoices", icon: FileText },
    { label: "Payments", to: "/payments", icon: CreditCard },
    { label: "Customers", to: "/customers", icon: Users },
    { label: "Billing Engine", to: "/billing", icon: Zap },
    { label: "Catalog & Plans", to: "/catalog", icon: Package },
    { label: "Discounts", to: "/discounts", icon: Tag },
  ];

  const adminItems = [
    { label: "User Management", to: "/users", icon: Shield },
    { label: "Audit Log", to: "/audit-log", icon: History },
    { label: "Outbox Queue", to: "/outbox", icon: Mail },
  ];

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      {/* Sidebar Desktop */}
      <aside className="hidden md:flex flex-col w-64 bg-slate-900 text-slate-300 border-r border-slate-800">
        <div className="flex items-center justify-between h-16 px-6 border-b border-slate-800">
          <Link to="/" className="flex items-center space-x-2">
            <div className="h-8 w-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white font-bold text-lg">
              O
            </div>
            <span className="text-xl font-bold text-white tracking-tight">OrbitLedger</span>
          </Link>
        </div>

        <nav className="flex-1 px-4 py-4 space-y-1 overflow-y-auto">
          <div className="text-xs font-semibold text-slate-500 uppercase px-3 mb-2 tracking-wider">
            Operations
          </div>
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) =>
                  `flex items-center px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-indigo-600 text-white font-semibold"
                      : "text-slate-400 hover:text-white hover:bg-slate-800"
                  }`
                }
              >
                <Icon className="h-4 w-4 mr-3" />
                {item.label}
              </NavLink>
            );
          })}

          {hasRole("admin") && (
            <>
              <div className="text-xs font-semibold text-slate-500 uppercase px-3 pt-6 mb-2 tracking-wider">
                Platform Admin
              </div>
              {adminItems.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={({ isActive }) =>
                      `flex items-center px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                        isActive
                          ? "bg-indigo-600 text-white font-semibold"
                          : "text-slate-400 hover:text-white hover:bg-slate-800"
                      }`
                    }
                  >
                    <Icon className="h-4 w-4 mr-3" />
                    {item.label}
                  </NavLink>
                );
              })}
            </>
          )}
        </nav>

        {/* Builder attribution */}
        <div className="px-4 py-2 border-t border-slate-800/80 bg-slate-950/40 text-[11px] text-slate-400">
          Built by <span className="text-white font-medium">B. Harisankar</span> & <span className="text-white font-medium">Rohan S</span>
        </div>

        {/* User badge at bottom */}
        <div className="p-4 border-t border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-3 overflow-hidden">
            <div className="h-9 w-9 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-300 font-bold text-sm">
              {user?.full_name?.charAt(0) || "U"}
            </div>
            <div className="overflow-hidden">
              <div className="text-sm font-medium text-white truncate">{user?.full_name}</div>
              <div className="text-xs text-slate-400 capitalize">{user?.role}</div>
            </div>
          </div>
          <button
            onClick={() => logout().then(() => navigate("/login"))}
            title="Log out"
            className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </aside>

      {/* Main Container */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top Navbar */}
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-4 sm:px-6 z-10">
          <div className="flex items-center space-x-4">
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden p-2 rounded-lg text-slate-600 hover:bg-slate-100 cursor-pointer"
            >
              {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </button>
            <div className="hidden sm:block text-slate-500 text-sm font-medium">
              OrbitLedger Subscription Operations
            </div>
          </div>

          <div className="flex items-center space-x-3">
            {/* Live SSE update badge */}
            <LiveIndicator />

            {/* Time travel button (Demo mode, admin only) */}
            {hasRole("admin") && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleTimeTravel}
                isLoading={timeTraveling}
                title="Advance injected Clock by 1 month and run billing"
                className="hidden lg:inline-flex text-indigo-700 border-indigo-200 bg-indigo-50 hover:bg-indigo-100"
              >
                <FastForward className="h-3.5 w-3.5 mr-1 text-indigo-600" />
                Time Travel +1 Mo
              </Button>
            )}

            <div className="flex items-center space-x-2 pl-2">
              <span className="text-xs font-medium px-2 py-1 rounded bg-slate-100 text-slate-700 uppercase tracking-wider">
                {user?.role}
              </span>
            </div>
          </div>
        </header>

        {/* Mobile Navigation Drawer */}
        {mobileMenuOpen && (
          <div className="md:hidden bg-slate-900 text-slate-300 p-4 border-b border-slate-800 space-y-2 z-50">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={() => setMobileMenuOpen(false)}
                className="flex items-center px-3 py-2 rounded-lg text-sm font-medium hover:bg-slate-800"
              >
                <item.icon className="h-4 w-4 mr-3" />
                {item.label}
              </NavLink>
            ))}
            {hasRole("admin") && (
              <>
                <div className="text-xs font-semibold text-slate-500 uppercase px-3 pt-3">Admin</div>
                {adminItems.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    onClick={() => setMobileMenuOpen(false)}
                    className="flex items-center px-3 py-2 rounded-lg text-sm font-medium hover:bg-slate-800"
                  >
                    <item.icon className="h-4 w-4 mr-3" />
                    {item.label}
                  </NavLink>
                ))}
              </>
            )}
            <div className="pt-4 border-t border-slate-800 flex justify-between items-center">
              <span className="text-sm">{user?.email}</span>
              <Button variant="danger" size="sm" onClick={() => logout().then(() => navigate("/login"))}>
                Log out
              </Button>
            </div>
          </div>
        )}

        {/* Content Outlet with smooth scrolling */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          <div className="max-w-7xl mx-auto">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
