import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/features/auth/AuthContext";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { ShieldCheck, Sparkles } from "lucide-react";

export function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const user = await login(email, password);
      if (user.role === "customer") {
        navigate("/portal");
      } else {
        navigate("/");
      }
    } catch (err: any) {
      setError(err.message || "Failed to sign in. Please verify your credentials.");
    } finally {
      setLoading(false);
    }
  };

  const fillCredentials = (roleEmail: string, rolePass: string) => {
    setEmail(roleEmail);
    setPassword(rolePass);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-slate-100 to-indigo-50">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex h-12 w-12 rounded-xl bg-indigo-600 items-center justify-center text-white font-bold text-2xl shadow-md">
            B
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Sign in to Brightloop</h1>
          <p className="text-sm text-slate-500">Subscription Management & Billing Automation</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Welcome back</CardTitle>
            <CardDescription>Enter your work email and password to access your workspace</CardDescription>
          </CardHeader>
          <CardContent>
            {error && (
              <div className="mb-4 p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-sm font-medium">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <Input
                label="Work Email"
                type="email"
                required
                placeholder="alex@brightloop.test"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />

              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-sm font-medium text-slate-700">Password</label>
                  <Link to="/forgot-password" className="text-xs text-indigo-600 hover:text-indigo-700 font-medium">
                    Forgot password?
                  </Link>
                </div>
                <Input
                  type="password"
                  required
                  placeholder="••••••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>

              <Button type="submit" className="w-full" isLoading={loading}>
                Sign in
              </Button>
            </form>

            <div className="mt-6 pt-4 border-t border-slate-200 text-center text-sm text-slate-600">
              Don't have an account?{" "}
              <Link to="/register" className="font-semibold text-indigo-600 hover:text-indigo-700">
                Create an account
              </Link>
            </div>
          </CardContent>
        </Card>

        {/* Demo Fast Fill Buttons for Hackathon Presentation */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-2">
          <div className="flex items-center text-xs font-semibold text-slate-500 uppercase tracking-wider">
            <Sparkles className="h-3.5 w-3.5 mr-1.5 text-indigo-500" />
            Quick Demo Logins (Click to prefill)
          </div>
          <div className="grid grid-cols-3 gap-2 pt-1">
            <button
              type="button"
              onClick={() => fillCredentials("admin@brightloop.test", "Admin@1234")}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-medium bg-slate-50 hover:bg-indigo-50 hover:text-indigo-700 hover:border-indigo-200 transition-colors"
            >
              Admin
            </button>
            <button
              type="button"
              onClick={() => fillCredentials("staff1@brightloop.test", "Staff@1234")}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-medium bg-slate-50 hover:bg-indigo-50 hover:text-indigo-700 hover:border-indigo-200 transition-colors"
            >
              Staff
            </button>
            <button
              type="button"
              onClick={() => fillCredentials("customer@brightloop.test", "Customer@1234")}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-medium bg-slate-50 hover:bg-indigo-50 hover:text-indigo-700 hover:border-indigo-200 transition-colors"
            >
              Customer
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
