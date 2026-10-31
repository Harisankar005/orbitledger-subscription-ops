import React, { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { useAuth } from "@/features/auth/AuthContext";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { User, Building, Phone, Mail, MapPin, CheckCircle, Save } from "lucide-react";

interface CustomerProfile {
  id: number;
  name: string;
  email: string;
  phone?: string;
  company?: string;
  billing_address?: string;
  tax_id?: string;
}

export function PortalProfile() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [company, setCompany] = useState("");
  const [billingAddress, setBillingAddress] = useState("");
  const [taxId, setTaxId] = useState("");
  const [isSuccess, setIsSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["portal-profile"],
    queryFn: () => api.get<CustomerProfile>("/portal/profile"),
  });

  useEffect(() => {
    if (data) {
      setName(data.name || "");
      setPhone(data.phone || "");
      setCompany(data.company || "");
      setBillingAddress(data.billing_address || "");
      setTaxId(data.tax_id || "");
    }
  }, [data]);

  const updateProfileMutation = useMutation({
    mutationFn: () =>
      api.patch("/portal/profile", {
        name,
        phone,
        company,
        billing_address: billingAddress,
        tax_id: taxId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["portal-profile"] });
      setIsSuccess(true);
      setTimeout(() => setIsSuccess(false), 3000);
    },
    onError: (err: any) => {
      setErrorMessage(err.message || "Failed to update profile");
    },
  });

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Account Profile</h1>
        <p className="text-sm text-slate-500 mt-1">
          Manage your organization details, billing address, and tax identification for compliant invoicing.
        </p>
      </div>

      {isSuccess && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm flex items-center space-x-2">
          <CheckCircle className="h-5 w-5 text-emerald-600" />
          <span>Profile details updated successfully. Future invoices will reflect these details.</span>
        </div>
      )}

      {errorMessage && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-sm">
          {errorMessage}
        </div>
      )}

      <Card className="p-6 bg-white border border-slate-200">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            updateProfileMutation.mutate();
          }}
          className="space-y-4"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Full Contact Name
              </label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your Name"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Primary Email
              </label>
              <Input
                value={data?.email || user?.email || ""}
                disabled
                className="bg-slate-50 text-slate-500"
              />
              <span className="text-[11px] text-slate-400 mt-1 block">
                Primary login email cannot be changed directly.
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Company / Organization
              </label>
              <Input
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                placeholder="Acme Technologies Ltd"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Contact Phone
              </label>
              <Input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+91 98765 43210"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              GSTIN / Tax ID
            </label>
            <Input
              value={taxId}
              onChange={(e) => setTaxId(e.target.value)}
              placeholder="e.g. 29AAAAA0000A1Z5"
            />
            <span className="text-[11px] text-slate-400 mt-1 block">
              Required for GST B2B tax invoice credit.
            </span>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Billing Address
            </label>
            <textarea
              value={billingAddress}
              onChange={(e) => setBillingAddress(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="Building, Street, City, State, Postal PIN"
            />
          </div>

          <div className="pt-2 flex justify-end">
            <Button
              type="submit"
              disabled={updateProfileMutation.isPending}
              className="flex items-center space-x-2"
            >
              <Save className="h-4 w-4 mr-1.5" />
              {updateProfileMutation.isPending ? "Saving Changes..." : "Save Changes"}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
