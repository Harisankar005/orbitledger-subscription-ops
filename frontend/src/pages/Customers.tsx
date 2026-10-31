import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "@/api/client";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/Dialog";
import { Users, Search, Plus, Edit, Repeat, Building, Mail, Phone, MapPin } from "lucide-react";

interface CustomerItem {
  id: number;
  user_id?: number;
  name: string;
  email: string;
  phone?: string;
  company?: string;
  billing_address?: string;
  tax_id?: string;
  created_at: string;
}

export function Customers() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(25);

  // Add / Edit Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<CustomerItem | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [company, setCompany] = useState("");
  const [billingAddress, setBillingAddress] = useState("");
  const [taxId, setTaxId] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

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
    setName("");
    setEmail("");
    setPhone("");
    setCompany("");
    setBillingAddress("");
    setTaxId("");
    setErrorMessage("");
    setIsModalOpen(true);
  };

  const openEditModal = (customer: CustomerItem) => {
    setEditingCustomer(customer);
    setName(customer.name);
    setEmail(customer.email);
    setPhone(customer.phone || "");
    setCompany(customer.company || "");
    setBillingAddress(customer.billing_address || "");
    setTaxId(customer.tax_id || "");
    setErrorMessage("");
    setIsModalOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = {
        name,
        email,
        phone: phone || undefined,
        company: company || undefined,
        billing_address: billingAddress || undefined,
        tax_id: taxId || undefined,
      };

      if (editingCustomer) {
        return api.patch(`/customers/${editingCustomer.id}`, payload);
      } else {
        return api.post("/customers", payload);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      setIsModalOpen(false);
    },
    onError: (err: any) => {
      setErrorMessage(err.message || "Failed to save customer");
    },
  });

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

      {/* Customers Table */}
      <Card className="overflow-hidden border border-slate-200 bg-white">
        <div className="overflow-x-auto">
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
              {isLoading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-slate-400">
                    Loading customers...
                  </td>
                </tr>
              ) : !data || data.items.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-slate-400">
                    No customers found.
                  </td>
                </tr>
              ) : (
                data.items.map((cust) => (
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
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Add / Edit Customer Modal */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingCustomer ? "Edit Customer" : "Add New Customer"}</DialogTitle>
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
                placeholder="e.g. John Doe"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Email *</label>
              <Input
                type="email"
                placeholder="john@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Company</label>
              <Input
                placeholder="e.g. Acme Corp"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Phone</label>
                <Input
                  placeholder="+91 98765 43210"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Tax ID / GSTIN</label>
                <Input
                  placeholder="29AAAAA0000A1Z5"
                  value={taxId}
                  onChange={(e) => setTaxId(e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Billing Address</label>
              <Input
                placeholder="Street, City, State, PIN"
                value={billingAddress}
                onChange={(e) => setBillingAddress(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsModalOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!name || !email || saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
            >
              {saveMutation.isPending ? "Saving..." : "Save Customer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
