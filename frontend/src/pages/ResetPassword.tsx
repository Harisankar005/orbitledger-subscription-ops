import React, { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "@/api/client";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Check, Circle } from "lucide-react";

export function ResetPassword() {
  const [searchParams] = useSearchParams();
  const [token, setToken] = useState(searchParams.get("token") || "");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  // Password Policy Checks (PLAN.md 5.1)
  const hasMinLength = newPassword.length >= 9;
  const hasUppercase = /[A-Z]/.test(newPassword);
  const hasLowercase = /[a-z]/.test(newPassword);
  const hasSpecial = /[^A-Za-z0-9]/.test(newPassword);
  const isPasswordValid = hasMinLength && hasUppercase && hasLowercase && hasSpecial;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isPasswordValid) {
      setError("Please ensure your new password satisfies all security criteria.");
      return;
    }

    setError(null);
    setLoading(true);

    try {
      await api.post("/auth/reset-password", {
        token: token.trim(),
        new_password: newPassword,
      });
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || "Failed to reset password. Token may be expired or invalid.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-slate-100 to-indigo-50">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex h-12 w-12 rounded-xl bg-indigo-600 items-center justify-center text-white font-bold text-2xl shadow-md">
            B
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
            {error && (
              <div className="mb-4 p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-sm font-medium">
                {error}
              </div>
            )}

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
              <form onSubmit={handleSubmit} className="space-y-4">
                <Input
                  label="Reset Token"
                  required
                  placeholder="Paste 32-character token from email"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                />

                <div>
                  <Input
                    label="New Password"
                    type="password"
                    required
                    placeholder="••••••••••••"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                  />

                  {/* Live Password Checklist */}
                  <div className="mt-3 p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-1.5 text-xs text-slate-600">
                    <div className="flex items-center space-x-2">
                      {hasMinLength ? <Check className="h-4 w-4 text-emerald-600" /> : <Circle className="h-4 w-4 text-slate-400" />}
                      <span className={hasMinLength ? "text-emerald-700 font-medium" : ""}>At least 9 characters</span>
                    </div>
                    <div className="flex items-center space-x-2">
                      {hasUppercase ? <Check className="h-4 w-4 text-emerald-600" /> : <Circle className="h-4 w-4 text-slate-400" />}
                      <span className={hasUppercase ? "text-emerald-700 font-medium" : ""}>At least one uppercase letter (A-Z)</span>
                    </div>
                    <div className="flex items-center space-x-2">
                      {hasLowercase ? <Check className="h-4 w-4 text-emerald-600" /> : <Circle className="h-4 w-4 text-slate-400" />}
                      <span className={hasLowercase ? "text-emerald-700 font-medium" : ""}>At least one lowercase letter (a-z)</span>
                    </div>
                    <div className="flex items-center space-x-2">
                      {hasSpecial ? <Check className="h-4 w-4 text-emerald-600" /> : <Circle className="h-4 w-4 text-slate-400" />}
                      <span className={hasSpecial ? "text-emerald-700 font-medium" : ""}>At least one special character</span>
                    </div>
                  </div>
                </div>

                <Button type="submit" className="w-full" isLoading={loading} disabled={!isPasswordValid || !token}>
                  Reset Password
                </Button>
              </form>
            )}

            <div className="mt-6 pt-4 border-t border-slate-200 text-center text-sm text-slate-600">
              <Link to="/login" className="font-semibold text-indigo-600 hover:text-indigo-700">
                Back to Sign in
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
