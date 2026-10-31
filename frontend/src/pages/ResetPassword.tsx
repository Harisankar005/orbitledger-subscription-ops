import React, { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { api } from "@/api/client";
import { useToast } from "@/context/ToastContext";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { PasswordChecklist, checkPasswordCriteria } from "@/components/auth/PasswordChecklist";
import { resetPasswordSchema, ResetPasswordFormData } from "@/lib/schemas";
import { handleServerErrors } from "@/lib/form-errors";
import { Check } from "lucide-react";

export function ResetPassword() {
  const [searchParams] = useSearchParams();
  const [success, setSuccess] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  const {
    register,
    handleSubmit,
    setError,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordFormData>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: {
      token: searchParams.get("token") || "",
      new_password: "",
      confirm_password: "",
    },
    mode: "onChange",
  });

  const newPasswordValue = watch("new_password") || "";
  const { isValid: isPasswordCriteriaMet } = checkPasswordCriteria(newPasswordValue);

  const onSubmit = async (data: ResetPasswordFormData) => {
    try {
      await api.post("/auth/reset-password", {
        token: data.token.trim(),
        new_password: data.new_password,
      });
      setSuccess(true);
      toast.success("Password updated successfully! All previous sessions revoked.");
    } catch (err: any) {
      handleServerErrors(err, setError, toast, "Failed to reset password. Token may be expired or invalid.");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-slate-100 to-indigo-50">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex h-12 w-12 rounded-xl bg-indigo-600 items-center justify-center text-white font-bold text-2xl shadow-md">
              O
            </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Set new password</h1>
          <p className="text-sm text-slate-500">Enter your secure token and choose a new password</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Reset Password</CardTitle>
            <CardDescription>Enter the token received in your email</CardDescription>
          </CardHeader>
          <CardContent>
            {success ? (
              <div className="text-center py-4 space-y-3">
                <div className="inline-flex h-12 w-12 rounded-full bg-emerald-100 text-emerald-600 items-center justify-center mx-auto">
                  <Check className="h-6 w-6" />
                </div>
                <h3 className="text-base font-semibold text-slate-900">Password Updated</h3>
                <p className="text-sm text-slate-600">
                  Your password has been reset successfully. All active sessions have been invalidated.
                </p>
                <div className="pt-4">
                  <Button className="w-full" onClick={() => navigate("/login")}>
                    Sign in with New Password
                  </Button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
                <Input
                  label="Reset Token"
                  required
                  placeholder="Paste 32-character token from email"
                  error={errors.token?.message}
                  {...register("token")}
                />

                <div>
                  <Input
                    label="New Password"
                    type="password"
                    required
                    placeholder="Create a strong password"
                    error={errors.new_password?.message}
                    {...register("new_password")}
                  />

                  <PasswordChecklist password={newPasswordValue} className="mt-3" />
                </div>

                <Input
                  label="Confirm Password"
                  type="password"
                  required
                  placeholder="Repeat new password"
                  error={errors.confirm_password?.message}
                  {...register("confirm_password")}
                />

                <Button
                  type="submit"
                  className="w-full"
                  isLoading={isSubmitting}
                  disabled={isSubmitting || !isPasswordCriteriaMet}
                >
                  Save New Password
                </Button>
              </form>
            )}

            <div className="mt-6 pt-4 border-t border-slate-200 text-center text-sm text-slate-600">
              Back to{" "}
              <Link to="/login" className="font-semibold text-indigo-600 hover:text-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 rounded">
                Sign in
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
