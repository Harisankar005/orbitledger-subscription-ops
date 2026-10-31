import React from "react";
import { Link, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAuth } from "@/features/auth/AuthContext";
import { useToast } from "@/context/ToastContext";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { PasswordChecklist, checkPasswordCriteria } from "@/components/auth/PasswordChecklist";
import { registerSchema, RegisterFormData } from "@/lib/schemas";
import { handleServerErrors } from "@/lib/form-errors";

export function Register() {
  const { register: registerAuth } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const {
    register,
    handleSubmit,
    setError,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      full_name: "",
      email: "",
      company: "",
      phone: "",
      password: "",
    },
    mode: "onChange",
  });

  const passwordValue = watch("password") || "";
  const { isValid: isPasswordCriteriaMet } = checkPasswordCriteria(passwordValue);

  const onSubmit = async (data: RegisterFormData) => {
    try {
      await registerAuth({
        full_name: data.full_name,
        email: data.email,
        company: data.company,
        phone: data.phone,
        password: data.password,
      });
      toast.success("Account created successfully! Welcome to your customer portal.");
      navigate("/portal");
    } catch (err: any) {
      handleServerErrors(err, setError, toast, "Registration failed. Please check the fields.");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-slate-100 to-indigo-50">
      <div className="w-full max-w-lg space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex h-12 w-12 rounded-xl bg-indigo-600 items-center justify-center text-white font-bold text-2xl shadow-md">
              O
            </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Create your account</h1>
          <p className="text-sm text-slate-500">Sign up for OrbitLedger customer billing and subscription portal</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Register</CardTitle>
            <CardDescription>Fill in your corporate details to activate your account</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
              <Input
                label="Full Name"
                required
                placeholder="Eleanor Vance"
                error={errors.full_name?.message}
                {...register("full_name")}
              />

              <Input
                label="Corporate Email"
                type="email"
                required
                placeholder="eleanor@acme.com"
                error={errors.email?.message}
                {...register("email")}
              />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input
                  label="Company Name"
                  placeholder="Acme Global Inc"
                  error={errors.company?.message}
                  {...register("company")}
                />
                <Input
                  label="Phone Number"
                  placeholder="+91 98765 43210"
                  error={errors.phone?.message}
                  {...register("phone")}
                />
              </div>

              <div>
                <Input
                  label="Password"
                  type="password"
                  required
                  placeholder="Create a strong password"
                  error={errors.password?.message}
                  {...register("password")}
                />

                <PasswordChecklist password={passwordValue} className="mt-3" />
              </div>

              <Button
                type="submit"
                className="w-full"
                isLoading={isSubmitting}
                disabled={isSubmitting || !isPasswordCriteriaMet}
              >
                Create Account
              </Button>
            </form>

            <div className="mt-6 pt-4 border-t border-slate-200 text-center text-sm text-slate-600">
              Already registered?{" "}
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
