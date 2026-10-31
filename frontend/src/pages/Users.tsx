import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { api } from "@/api/client";
import { formatDate } from "@/lib/utils";
import { useToast } from "@/context/ToastContext";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/Dialog";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { PasswordChecklist, checkPasswordCriteria } from "@/components/auth/PasswordChecklist";
import { addStaffSchema, AddStaffFormData } from "@/lib/schemas";
import { handleServerErrors } from "@/lib/form-errors";
import { Shield, UserPlus, Lock, AlertCircle, Power } from "lucide-react";

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
  const { toast } = useToast();
  const [isModalOpen, setIsModalOpen] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<AddStaffFormData>({
    resolver: zodResolver(addStaffSchema),
    defaultValues: {
      full_name: "",
      email: "",
      password: "",
    },
    mode: "onChange",
  });

  const passwordValue = watch("password") || "";
  const { isValid: isPasswordCriteriaMet } = checkPasswordCriteria(passwordValue);

  const { data, isLoading } = useQuery({
    queryKey: ["users"],
    queryFn: () => api.get<{ items: UserItem[]; total: number }>("/users"),
  });

  const createStaffMutation = useMutation({
    mutationFn: (formData: AddStaffFormData) => api.post("/users/staff", formData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      toast.success("Staff user provisioned successfully!");
      setIsModalOpen(false);
      reset();
    },
    onError: (err: any) => handleServerErrors(err, setError, toast, "Failed to create staff user"),
  });

  const toggleStatusMutation = useMutation({
    mutationFn: ({ userId, isActive }: { userId: number; isActive: boolean }) =>
      api.patch(`/users/${userId}`, { is_active: !isActive }),
    onSuccess: (updatedUser: any) => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      toast.success(`User ${updatedUser.email} is now ${updatedUser.is_active ? "active" : "deactivated"}`);
    },
    onError: (err: any) => toast.error(err.message || "Failed to update user status"),
  });

  const roleBadges: Record<string, string> = {
    admin: "bg-rose-100 text-rose-800 border-rose-200",
    staff: "bg-indigo-100 text-indigo-800 border-indigo-200",
    customer: "bg-emerald-100 text-emerald-800 border-emerald-200",
  };

  const openModal = () => {
    reset({
      full_name: "",
      email: "",
      password: "",
    });
    setIsModalOpen(true);
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
        <Button size="sm" onClick={openModal}>
          <UserPlus className="h-4 w-4 mr-1.5" />
          Create Staff User
        </Button>
      </div>

      {/* Users Table */}
      <Card className="overflow-hidden border border-slate-200 bg-white">
        {isLoading ? (
          <div className="p-6">
            <TableSkeleton rows={4} cols={5} />
          </div>
        ) : !data || data.items.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={Shield}
              title="No users found"
              description="Get started by provisioning internal staff accounts."
              actionLabel="Create Staff User"
              onAction={openModal}
            />
          </div>
        ) : (
          <>
            {/* Desktop Table View */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-6 py-3 text-left font-semibold text-slate-600">User</th>
                    <th className="px-6 py-3 text-left font-semibold text-slate-600">Role</th>
                    <th className="px-6 py-3 text-left font-semibold text-slate-600">Status</th>
                    <th className="px-6 py-3 text-left font-semibold text-slate-600">Security</th>
                    <th className="px-6 py-3 text-left font-semibold text-slate-600">Created</th>
                    <th className="px-6 py-3 text-right font-semibold text-slate-600">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {data.items.map((u) => {
                    const isLocked = u.locked_until && new Date(u.locked_until) > new Date();
                    return (
                      <tr key={u.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-6 py-4">
                          <div className="font-semibold text-slate-900">{u.full_name || u.email}</div>
                          <div className="text-xs text-slate-500">{u.email}</div>
                        </td>
                        <td className="px-6 py-4">
                          <span
                            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold capitalize border ${
                              roleBadges[u.role] || "bg-slate-100 text-slate-700"
                            }`}
                          >
                            {u.role}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          {u.is_active ? (
                            <span className="inline-flex items-center text-xs font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                              Active
                            </span>
                          ) : (
                            <span className="inline-flex items-center text-xs font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                              Deactivated
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-xs">
                          {isLocked ? (
                            <span className="inline-flex items-center font-semibold text-rose-700 bg-rose-50 px-2 py-0.5 rounded border border-rose-200">
                              <Lock className="h-3 w-3 mr-1" />
                              Locked ({formatDate(u.locked_until)})
                            </span>
                          ) : u.failed_logins > 0 ? (
                            <span className="text-amber-700 font-medium flex items-center">
                              <AlertCircle className="h-3 w-3 mr-1" />
                              {u.failed_logins} failed login(s)
                            </span>
                          ) : (
                            <span className="text-slate-400">Clean</span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-xs text-slate-500">{formatDate(u.created_at)}</td>
                        <td className="px-6 py-4 text-right">
                          {u.role !== "admin" && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => toggleStatusMutation.mutate({ userId: u.id, isActive: u.is_active })}
                              disabled={toggleStatusMutation.isPending}
                            >
                              <Power className={`h-3.5 w-3.5 mr-1 ${u.is_active ? "text-emerald-600" : "text-slate-400"}`} />
                              {u.is_active ? "Deactivate" : "Activate"}
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Cards View (<640px) */}
            <div className="sm:hidden divide-y divide-slate-100">
              {data.items.map((u) => (
                <div key={u.id} className="p-4 space-y-2">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="font-semibold text-slate-900">{u.full_name || u.email}</div>
                      <div className="text-xs text-slate-500">{u.email}</div>
                    </div>
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold capitalize border ${
                        roleBadges[u.role] || "bg-slate-100 text-slate-700"
                      }`}
                    >
                      {u.role}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-xs pt-1">
                    <span className={u.is_active ? "text-emerald-700 font-medium" : "text-slate-500"}>
                      Status: {u.is_active ? "Active" : "Deactivated"}
                    </span>
                    {u.role !== "admin" && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => toggleStatusMutation.mutate({ userId: u.id, isActive: u.is_active })}
                        disabled={toggleStatusMutation.isPending}
                      >
                        <Power className={`h-3 w-3 mr-1 ${u.is_active ? "text-emerald-600" : "text-slate-400"}`} />
                        {u.is_active ? "Deactivate" : "Activate"}
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </Card>

      {/* Add Staff Modal */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Provision Staff Member</DialogTitle>
          </DialogHeader>

          <form
            onSubmit={handleSubmit((data) => createStaffMutation.mutate(data))}
            className="space-y-4 py-2"
            noValidate
          >
            <Input
              label="Full Name"
              required
              placeholder="e.g. Maya Patel"
              error={errors.full_name?.message}
              {...register("full_name")}
            />

            <Input
              label="Staff Email"
              type="email"
              required
              placeholder="maya@brightloop.test"
              error={errors.email?.message}
              {...register("email")}
            />

            <div>
              <Input
                label="Initial Password"
                type="password"
                required
                placeholder="Temporary secure password"
                error={errors.password?.message}
                {...register("password")}
              />

              <PasswordChecklist password={passwordValue} className="mt-3" />
            </div>

            <DialogFooter>
              <Button variant="outline" type="button" onClick={() => setIsModalOpen(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                isLoading={createStaffMutation.isPending || isSubmitting}
                disabled={createStaffMutation.isPending || isSubmitting || !isPasswordCriteriaMet}
              >
                Provision Staff User
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
