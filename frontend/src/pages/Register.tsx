import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/features/auth/AuthContext";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Check, Circle } from "lucide-react";

export function Register() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const { register } = useAuth();
  const navigate = useNavigate();

  // Password Policy Checks (PLAN.md 5.1)
  const hasMinLength = password.length >= 9;
  const hasUppercase = /[A-Z]/.test(password);
  const hasLowercase = /[a-z]/.test(password);
  const hasSpecial = /[^A-Za-z0-9]/.test(password);
  const isPasswordValid = hasMinLength && hasUppercase && hasLowercase && hasSpecial;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isPasswordValid) {
      setError("Please ensure your password satisfies all security criteria.");
      return;
    }

    setError(null);
    setLoading(true);

    try {
      await register({
        full_name: fullName,
        email,
        company,
        phone,
        password,
      });
      navigate("/portal");
    } catch (err: any) {
      setError(err.message || "Registration failed. Please check the fields.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-slate-100 to-indigo-50">
      <div className="w-full max-w-lg space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex h-12 w-12 rounded-xl bg-indigo-600 items-center justify-center text-white font-bold text-2xl shadow-md">
            B
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Create your account</h1>
          <p className="text-sm text-slate-500">Sign up for Brightloop customer billing and subscription portal</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Register</CardTitle>
            <CardDescription>Fill in your corporate details to activate your account</CardDescription>
          </CardHeader>
          <CardContent>
            {error && (
              <div className="mb-4 p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-sm font-medium">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <Input
                label="Full Name"
                required
                placeholder="Eleanor Vance"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
              />

              <Input
                label="Corporate Email"
                type="email"
                required
                placeholder="eleanor@acme.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input
                  label="Company Name"
                  placeholder="Acme Global Inc"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                />
                <Input
                  label="Phone Number"
                  placeholder="+91 98765 43210"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>

              <div>
                <Input
                  label="Password"
                  type="password"
                  required
                  placeholder="Create a strong password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />

                {/* Live Password Checklist (PLAN.md 5.1 & P3) */}
                <div className="mt-3 p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-1.5 text-xs text-slate-600">
                  <div className="font-semibold text-slate-700 mb-1">Password Requirements:</div>
                  <div className="flex items-center space-x-2">
                    {hasMinLength ? (
                      <Check className="h-4 w-4 text-emerald-600" />
                    ) : (
                      <Circle className="h-4 w-4 text-slate-400" />
                    )}
                    <span className={hasMinLength ? "text-emerald-700 font-medium" : ""}>
                      More than 8 characters (at least 9 characters)
                    </span>
                  </div>
                  <div className="flex items-center space-x-2">
                    {hasUppercase ? (
                      <Check className="h-4 w-4 text-emerald-600" />
                    ) : (
                      <Circle className="h-4 w-4 text-slate-400" />
                    )}
                    <span className={hasUppercase ? "text-emerald-700 font-medium" : ""}>
                      At least one uppercase letter (A-Z)
                    </span>
                  </div>
                  <div className="flex items-center space-x-2">
                    {hasLowercase ? (
                      <Check className="h-4 w-4 text-emerald-600" />
                    ) : (
                      <Circle className="h-4 w-4 text-slate-400" />
                    )}
                    <span className={hasLowercase ? "text-emerald-700 font-medium" : ""}>
                      At least one lowercase letter (a-z)
                    </span>
                  </div>
                  <div className="flex items-center space-x-2">
                    {hasSpecial ? (
                      <Check className="h-4 w-4 text-emerald-600" />
                    ) : (
                      <Circle className="h-4 w-4 text-slate-400" />
                    )}
                    <span className={hasSpecial ? "text-emerald-700 font-medium" : ""}>
                      At least one special character (!@#$%^&* etc.)
                    </span>
                  </div>
                </div>
              </div>

              <Button type="submit" className="w-full" isLoading={loading} disabled={!isPasswordValid}>
                Create Account
              </Button>
            </form>

            <div className="mt-6 pt-4 border-t border-slate-200 text-center text-sm text-slate-600">
              Already registered?{" "}
              <Link to="/login" className="font-semibold text-indigo-600 hover:text-indigo-700">
                Sign in
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
