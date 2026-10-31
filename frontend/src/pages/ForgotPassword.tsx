import React, { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/api/client";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { MailCheck } from "lucide-react";

export function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post("/auth/forgot-password", { email });
    } finally {
      setSubmitted(true);
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
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Reset your password</h1>
          <p className="text-sm text-slate-500">We'll send a single-use secure reset token</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Forgot password</CardTitle>
            <CardDescription>Enter the email address associated with your Brightloop account</CardDescription>
          </CardHeader>
          <CardContent>
            {submitted ? (
              <div className="text-center py-4 space-y-3">
                <div className="inline-flex h-12 w-12 rounded-full bg-emerald-100 text-emerald-600 items-center justify-center mx-auto">
                  <MailCheck className="h-6 w-6" />
                </div>
                <h3 className="text-base font-semibold text-slate-900">Check your inbox</h3>
                <p className="text-sm text-slate-600">
                  If that email is registered, instructions and a reset token have been dispatched to Mailpit.
                </p>
                <div className="pt-4">
                  <Link to="/reset-password">
                    <Button variant="outline" className="w-full">
                      Enter Reset Token
                    </Button>
                  </Link>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <Input
                  label="Account Email"
                  type="email"
                  required
                  placeholder="admin@brightloop.test"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <Button type="submit" className="w-full" isLoading={loading}>
                  Send Reset Link
                </Button>
              </form>
            )}

            <div className="mt-6 pt-4 border-t border-slate-200 text-center text-sm text-slate-600">
              Remember your password?{" "}
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
