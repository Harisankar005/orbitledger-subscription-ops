import React from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "@/features/auth/AuthContext";
import { Button } from "@/components/ui/Button";
import { Repeat, FileText, User as UserIcon, LogOut } from "lucide-react";

export function PortalShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Portal Top Navigation Bar */}
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-8">
            <Link to="/portal" className="flex items-center space-x-2">
              <div className="h-8 w-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white font-bold">
              O
            </div>
              <span className="text-lg font-bold text-slate-900 tracking-tight">OrbitLedger Customer Portal</span>
            </Link>

            <nav className="hidden sm:flex space-x-4">
              <NavLink
                to="/portal"
                end
                className={({ isActive }) =>
                  `flex items-center px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    isActive ? "bg-indigo-50 text-indigo-700 font-semibold" : "text-slate-600 hover:text-slate-900"
                  }`
                }
              >
                <Repeat className="h-4 w-4 mr-2" />
                My Subscriptions
              </NavLink>
              <NavLink
                to="/portal/invoices"
                className={({ isActive }) =>
                  `flex items-center px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    isActive ? "bg-indigo-50 text-indigo-700 font-semibold" : "text-slate-600 hover:text-slate-900"
                  }`
                }
              >
                <FileText className="h-4 w-4 mr-2" />
                My Invoices
              </NavLink>
              <NavLink
                to="/portal/profile"
                className={({ isActive }) =>
                  `flex items-center px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    isActive ? "bg-indigo-50 text-indigo-700 font-semibold" : "text-slate-600 hover:text-slate-900"
                  }`
                }
              >
                <UserIcon className="h-4 w-4 mr-2" />
                Profile
              </NavLink>
            </nav>
          </div>

          <div className="flex items-center space-x-4">
            <div className="text-right hidden sm:block">
              <div className="text-sm font-medium text-slate-900">{user?.full_name}</div>
              <div className="text-xs text-slate-500">{user?.email}</div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => logout().then(() => navigate("/login"))}
              className="text-slate-600"
            >
              <LogOut className="h-4 w-4 mr-1.5" />
              Sign Out
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8">
        <Outlet />
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white py-3 text-center text-xs text-slate-400">
        OrbitLedger Platform • Built for Odoo Hackathon by <span className="font-medium text-slate-600">B. Harisankar</span> & <span className="font-medium text-slate-600">Rohan S</span>
      </footer>
    </div>
  );
}
