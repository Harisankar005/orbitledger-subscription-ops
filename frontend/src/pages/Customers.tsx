import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { api } from "@/api/client";
import { useToast } from "@/context/ToastContext";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/Dialog";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { customerSchema, CustomerFormData } from "@/lib/schemas";
import { handleServerErrors } from "@/lib/form-errors";
import { Users, Search, Plus, Edit, Repeat, Building, Mail, Phone } from "lucide-react";

interface CustomerItem {
  id: number;
  user_id?: number;
  name: string;
  email: string;
  phone?: string;
  company?: string;
  address?: string;
  billing_address?: string;
  tax_id?: string;
  created_at: string;
}

export function Customers() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(25);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<CustomerItem | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<CustomerFormData>({
    resolver: zodResolver(customerSchema),
    defaultValues: {
      name: "",
      email: "",
      phone: "",
      company: "",
      address: "",
      tax_id: "",
      is_active: true,
    },
  });

  const { data, isLoading } = useQuery({
    queryKey: ["customers", search, page, pageSize],
    queryFn: () => {
      const params = new URLSearchParams({
        page: page.toString(),
        page_size: pageSize.toString(),
      });
      if (search) params.append("search", search);
      return api.get<{ items: CustomerItem[]; total: number }>(`/customers?${params.toString()}`);
    },
  });

  const openAddModal = () => {
    setEditingCustomer(null);
    reset({
      name: "",
      email: "",
      phone: "",
      company: "",
      address: "",
      tax_id: "",
      is_active: true,
    });
    setIsModalOpen(true);
  };

  const openEditModal = (customer: CustomerItem) => {
    setEditingCustomer(customer);
    reset({
      name: customer.name,
      email: customer.email,
      phone: customer.phone || "",
      company: customer.company || "",
      address: customer.billing_address || customer.address || "",
      tax_id: customer.tax_id || "",
      is_active: true,
    });
    setIsModalOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: (formData: CustomerFormData) => {
      const payload = {
        name: formData.name,
        email: formData.email,
        phone: formData.phone || undefined,
        company: formData.company || undefined,
        billing_address: formData.address || undefined,
        tax_id: formData.tax_id || undefined,
      };

      if (editingCustomer) {
        return api.patch(`/customers/${editingCustomer.id}`, payload);
      } else {
        return api.post("/customers", payload);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      toast.success(editingCustomer ? "Customer updated successfully!" : "Customer added successfully!");
      setIsModalOpen(false);
    },
    onError: (err: any) => {
      handleServerErrors(err, setError, toast, "Failed to save customer");
    },
  });

  const onSubmit = (formData: CustomerFormData) => {
    saveMutation.mutate(formData);
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Customers</h1>
          <p className="text-sm text-slate-500 mt-1">
            Manage subscriber accounts, tax IDs, and billing contacts.
          </p>
        </div>
        <Button size="sm" onClick={openAddModal}>
          <Plus className="h-4 w-4 mr-1.5" />
          Add Customer
        </Button>
      </div>

      {/* Search Bar */}
      <Card className="p-4 bg-white border border-slate-200">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            placeholder="Search by name, email, or company..."
            className="pl-9"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
      </Card>

      {/* Customers Table / Mobile Cards */}
      <Card className="overflow-hidden border border-slate-200 bg-white">
        {isLoading ? (
          <div className="p-6">
            <TableSkeleton rows={5} cols={5} />
          </div>
        ) : !data || data.items.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={Users}
              title="No customers found"
              description={search ? "Try adjusting your search query." : "Get started by adding your first customer account."}
              actionLabel={search ? undefined : "Add Customer"}
              onAction={search ? undefined : openAddModal}
            />
          </div>
        ) : (
          <>
            {/* Desktop Table View */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-6 py-3 text-left font-semibold text-slate-600">Customer</th>
                    <th className="px-6 py-3 text-left font-semibold text-slate-600">Company</th>
                    <th className="px-6 py-3 text-left font-semibold text-slate-600">Contact</th>
                    <th className="px-6 py-3 text-left font-semibold text-slate-600">Tax ID / GSTIN</th>
                    <th className="px-6 py-3 text-right font-semibold text-slate-600">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {data.items.map((cust) => (
                    <tr key={cust.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-4">
                        <div className="font-semibold text-slate-900">{cust.name}</div>
                        <div className="text-xs text-slate-400 font-mono">ID: #{cust.id}</div>
                      </td>
                      <td className="px-6 py-4 text-slate-700">
                        {cust.company ? (
                          <div className="flex items-center space-x-1.5">
                            <Building className="h-3.5 w-3.5 text-slate-400" />
                            <span>{cust.company}</span>
                          </div>
                        ) : (
                          <span className="text-slate-400 italic">Individual</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-xs text-slate-600">
                        <div className="flex items-center space-x-1.5 mb-1">
                          <Mail className="h-3.5 w-3.5 text-slate-400" />
                          <span>{cust.email}</span>
                        </div>
                        {cust.phone && (
                          <div className="flex items-center space-x-1.5 text-slate-400">
                            <Phone className="h-3.5 w-3.5" />
                            <span>{cust.phone}</span>
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 font-mono text-xs text-slate-700">
                        {cust.tax_id || <span className="text-slate-400">N/A</span>}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end space-x-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openEditModal(cust)}
                          >
                            <Edit className="h-3.5 w-3.5 mr-1" />
                            Edit
                          </Button>
                          <Link to={`/subscriptions?customer=${cust.id}`}>
                            <Button variant="ghost" size="sm">
                              <Repeat className="h-3.5 w-3.5 mr-1" />
                              Subs
                            </Button>
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Cards View (<640px) */}
            <div className="sm:hidden divide-y divide-slate-100">
              {data.items.map((cust) => (
                <div key={cust.id} className="p-4 space-y-2">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="font-semibold text-slate-900">{cust.name}</div>
                      <div className="text-xs text-slate-400 font-mono">ID: #{cust.id}</div>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Button variant="outline" size="sm" onClick={() => openEditModal(cust)}>
                        <Edit className="h-3.5 w-3.5 mr-1" />
                        Edit
                      </Button>
                      <Link to={`/subscriptions?customer=${cust.id}`}>
                        <Button variant="ghost" size="sm">
                          <Repeat className="h-3.5 w-3.5" />
                        </Button>
                      </Link>
                    </div>
                  </div>
                  <div className="text-xs text-slate-600 space-y-1 pt-1">
                    <div className="flex items-center space-x-1.5">
                      <Mail className="h-3.5 w-3.5 text-slate-400" />
                      <span>{cust.email}</span>
                    </div>
                    {cust.company && (
                      <div className="flex items-center space-x-1.5">
                        <Building className="h-3.5 w-3.5 text-slate-400" />
                        <span>{cust.company}</span>
                      </div>
                    )}
                    {cust.tax_id && (
                      <div className="font-mono text-slate-500">
                        Tax ID: {cust.tax_id}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </Card>

      {/* Add / Edit Customer Modal */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingCustomer ? "Edit Customer" : "Add New Customer"}</DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 py-2" noValidate>
            <Input
              label="Full Name"
              required
              placeholder="e.g. John Doe"
              error={errors.name?.message}
              {...register("name")}
            />

            <Input
              label="Email"
              type="email"
              required
              placeholder="john@example.com"
              error={errors.email?.message}
              {...register("email")}
            />

            <Input
              label="Company"
              placeholder="e.g. Acme Corp"
              error={errors.company?.message}
              {...register("company")}
            />

            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Phone"
                placeholder="+91 98765 43210"
                error={errors.phone?.message}
                {...register("phone")}
              />
              <Input
                label="Tax ID / GSTIN"
                placeholder="29AAAAA0000A1Z5"
                error={errors.tax_id?.message}
                {...register("tax_id")}
              />
            </div>

            <Input
              label="Billing Address"
              placeholder="Street, City, State, PIN"
              error={errors.address?.message}
              {...register("address")}
            />

            <DialogFooter>
              <Button variant="outline" type="button" onClick={() => setIsModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" isLoading={saveMutation.isPending || isSubmitting} disabled={saveMutation.isPending || isSubmitting}>
                {editingCustomer ? "Update Customer" : "Save Customer"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
