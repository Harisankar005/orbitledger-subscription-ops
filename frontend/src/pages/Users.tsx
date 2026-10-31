import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { formatDate } from "@/lib/utils";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/Dialog";
import { Shield, UserPlus, Check, X, Lock, CheckCircle2, AlertCircle } from "lucide-react";

interface UserItem {
  id: number;
  email: string;
  role: "admin" | "staff" | "customer";
  full_name: string;
  is_active: boolean;
  failed_logins: number;
  locked_until?: string;
  created_at: string;
}

export function Users() {
  const queryClient = useQueryClient();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["users"],
    queryFn: () => api.get<{ items: UserItem[]; total: number }>("/users"),
  });

  // Password policy checklist: > 8 chars (>=9), 1 upper, 1 lower, 1 special
  const pwLength = password.length > 8;
  const pwUpper = /[A-Z]/.test(password);
  const pwLower = /[a-z]/.test(password);
  const pwSpecial = /[^A-Za-z0-9]/.test(password);
  const isPasswordValid = pwLength && pwUpper && pwLower && pwSpecial;

  const createStaffMutation = useMutation({
    mutationFn: () =>
      api.post("/users/staff", {
        email,
        full_name: fullName,
        password,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      setIsModalOpen(false);
      setEmail("");
      setFullName("");
      setPassword("");
      setErrorMessage("");
    },
    onError: (err: any) => {
      setErrorMessage(err.message || "Failed to create staff user");
    },
  });

  const toggleStatusMutation = useMutation({
    mutationFn: ({ userId, isActive }: { userId: number; isActive: boolean }) =>
      api.patch(`/users/${userId}`, { is_active: !isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
    },
  });

  const roleBadges: Record<string, string> = {
    admin: "bg-rose-100 text-rose-800 border-rose-200",
    staff: "bg-indigo-100 text-indigo-800 border-indigo-200",
    customer: "bg-emerald-100 text-emerald-800 border-emerald-200",
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">User Management</h1>
          <p className="text-sm text-slate-500 mt-1">
            Admin oversight: provision staff members, manage roles, and review security lockouts.
          </p>
        </div>
        <Button size="sm" onClick={() => setIsModalOpen(true)}>
          <UserPlus className="h-4 w-4 mr-1.5" />
          Create Staff User
        </Button>
      </div>

      {/* Users Table */}
      <Card className="overflow-hidden border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-6 py-3 text-left font-semibold text-slate-600">User</th>
                <th className="px-6 py-3 text-left font-semibold text-slate-600">Role</th>
                <th className="px-6 py-3 text-left font-semibold text-slate-600">Status</th>
                <th className="px-6 py-3 text-left font-semibold text-slate-600">Security</th>
                <th className="px-6 py-3 text-left font-semibold text-slate-600">Joined</th>
                <th className="px-6 py-3 text-right font-semibold text-slate-600">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-slate-400">
                    Loading users...
                  </td>
                </tr>
              ) : !data || data.items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-slate-400">
                    No users found.
                  </td>
                </tr>
              ) : (
                data.items.map((user) => (
                  <tr key={user.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="font-semibold text-slate-900">{user.full_name}</div>
                      <div className="text-xs text-slate-500">{user.email}</div>
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold capitalize border ${
                          roleBadges[user.role] || "bg-slate-100 text-slate-800"
                        }`}
                      >
                        {user.role}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      {user.is_active ? (
                        <span className="inline-flex items-center text-xs font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center text-xs font-medium text-slate-600 bg-slate-100 px-2 py-0.5 rounded">
                          Disabled
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-xs">
                      {user.locked_until ? (
                        <span className="inline-flex items-center text-rose-700 font-semibold bg-rose-50 px-2 py-0.5 rounded border border-rose-200">
                          <Lock className="h-3 w-3 mr-1" />
                          Locked until {formatDate(user.locked_until)}
                        </span>
                      ) : (
                        <span className="text-slate-500">
                          {user.failed_logins} failed login attempts
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-xs text-slate-500">
                      {formatDate(user.created_at)}
                    </td>
                    <td className="px-6 py-4 text-right">
                      {user.role !== "admin" && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            toggleStatusMutation.mutate({
                              userId: user.id,
                              isActive: user.is_active,
                            })
                          }
                          disabled={toggleStatusMutation.isPending}
                        >
                          {user.is_active ? "Disable" : "Enable"}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Create Staff Modal */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Provision Staff Member</DialogTitle>
          </DialogHeader>

          {errorMessage && (
            <div className="p-3 text-xs bg-rose-50 text-rose-700 rounded-lg border border-rose-200">
              {errorMessage}
            </div>
          )}

          <div className="space-y-4 py-2">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Full Name *</label>
              <Input
                placeholder="e.g. Maya Staff"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Staff Email *</label>
              <Input
                type="email"
                placeholder="staff@brightloop.test"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Password (Argon2id Enforced) *
              </label>
              <Input
                type="password"
                placeholder="••••••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />

              {/* Password Checklist */}
              <div className="mt-2 space-y-1 bg-slate-50 p-2.5 rounded-lg border border-slate-200 text-xs">
                <div
                  className={`flex items-center space-x-1.5 ${
                    pwLength ? "text-emerald-600 font-medium" : "text-slate-500"
                  }`}
                >
                  {pwLength ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                  <span>More than 8 characters (min 9)</span>
                </div>
                <div
                  className={`flex items-center space-x-1.5 ${
                    pwUpper ? "text-emerald-600 font-medium" : "text-slate-500"
                  }`}
                >
                  {pwUpper ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                  <span>At least one uppercase letter (A-Z)</span>
                </div>
                <div
                  className={`flex items-center space-x-1.5 ${
                    pwLower ? "text-emerald-600 font-medium" : "text-slate-500"
                  }`}
                >
                  {pwLower ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                  <span>At least one lowercase letter (a-z)</span>
                </div>
                <div
                  className={`flex items-center space-x-1.5 ${
                    pwSpecial ? "text-emerald-600 font-medium" : "text-slate-500"
                  }`}
                >
                  {pwSpecial ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                  <span>At least one special character (!@#$%^&*)</span>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsModalOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!email || !fullName || !isPasswordValid || createStaffMutation.isPending}
              onClick={() => createStaffMutation.mutate()}
            >
              {createStaffMutation.isPending ? "Creating..." : "Create Staff"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
