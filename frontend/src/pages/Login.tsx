import React from "react";
import { Link, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAuth } from "@/features/auth/AuthContext";
import { useToast } from "@/context/ToastContext";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { loginSchema, LoginFormData } from "@/lib/schemas";
import { handleServerErrors } from "@/lib/form-errors";

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const {
    register,
    handleSubmit,
    setError,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  const onSubmit = async (data: LoginFormData) => {
    try {
      const user = await login(data.email, data.password);
      toast.success(`Welcome back, ${user.full_name || user.email}!`);
      if (user.role === "customer") {
        navigate("/portal");
      } else {
        navigate("/");
      }
    } catch (err: any) {
      handleServerErrors(err, setError, toast, "Failed to sign in. Please verify your credentials.");
    }
  };

  const fillCredentials = (roleEmail: string, rolePass: string) => {
    setValue("email", roleEmail, { shouldValidate: true });
    setValue("password", rolePass, { shouldValidate: true });
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-slate-100 to-indigo-50">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex h-12 w-12 rounded-xl bg-indigo-600 items-center justify-center text-white font-bold text-2xl shadow-md">
              O
            </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Sign in to OrbitLedger</h1>
          <p className="text-sm text-slate-500">Subscription Management & Billing Automation</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Welcome back</CardTitle>
            <CardDescription>Enter your work email and password to access your workspace</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
              <Input
                label="Work Email"
                type="email"
                required
                placeholder="admin@brightloop.test"
                error={errors.email?.message}
                {...register("email")}
              />

              <div>
                <div className="flex justify-between items-center mb-1">
                  <label htmlFor="login-password" className="text-sm font-medium text-slate-700">
                    Password <span className="text-rose-500" aria-hidden="true">*</span>
                  </label>
                  <Link to="/forgot-password" className="text-xs text-indigo-600 hover:text-indigo-700 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 rounded">
                    Forgot password?
                  </Link>
                </div>
                <Input
                  id="login-password"
                  type="password"
                  required
                  placeholder="••••••••••••"
                  error={errors.password?.message}
                  {...register("password")}
                />
              </div>

              <Button type="submit" className="w-full" isLoading={isSubmitting} disabled={isSubmitting}>
                Sign in
              </Button>
            </form>

            <div className="mt-6 pt-4 border-t border-slate-200 text-center text-sm text-slate-600">
              Don't have an account?{" "}
              <Link to="/register" className="font-semibold text-indigo-600 hover:text-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 rounded">
                Create an account
              </Link>
            </div>

            {/* Quick Demo Credentials */}
            <div className="mt-6 p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs text-slate-600">
              <span className="font-semibold text-slate-700 block mb-1.5">Quick Demo Logins:</span>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => fillCredentials("admin@brightloop.test", "Admin@1234")}
                  className="px-2 py-1 rounded bg-white border border-slate-300 hover:bg-slate-100 font-medium text-slate-700 cursor-pointer focus-visible:ring-2 focus-visible:ring-indigo-600"
                >
                  Admin
                </button>
                <button
                  type="button"
                  onClick={() => fillCredentials("staff1@brightloop.test", "Staff@1234")}
                  className="px-2 py-1 rounded bg-white border border-slate-300 hover:bg-slate-100 font-medium text-slate-700 cursor-pointer focus-visible:ring-2 focus-visible:ring-indigo-600"
                >
                  Staff
                </button>
                <button
                  type="button"
                  onClick={() => fillCredentials("customer@brightloop.test", "Customer@1234")}
                  className="px-2 py-1 rounded bg-white border border-slate-300 hover:bg-slate-100 font-medium text-slate-700 cursor-pointer focus-visible:ring-2 focus-visible:ring-indigo-600"
                >
                  Customer
                </button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
