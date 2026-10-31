import React from "react";
import { Check, Circle } from "lucide-react";

export interface PasswordCriteria {
  hasMinLength: boolean;
  hasUppercase: boolean;
  hasLowercase: boolean;
  hasSpecial: boolean;
  isValid: boolean;
}

export function checkPasswordCriteria(password: string): PasswordCriteria {
  const hasMinLength = password.length >= 9;
  const hasUppercase = /[A-Z]/.test(password);
  const hasLowercase = /[a-z]/.test(password);
  const hasSpecial = /[^A-Za-z0-9]/.test(password);
  const isValid = hasMinLength && hasUppercase && hasLowercase && hasSpecial;

  return {
    hasMinLength,
    hasUppercase,
    hasLowercase,
    hasSpecial,
    isValid,
  };
}

interface PasswordChecklistProps {
  password?: string;
  className?: string;
}

export function PasswordChecklist({ password = "", className = "" }: PasswordChecklistProps) {
  const { hasMinLength, hasUppercase, hasLowercase, hasSpecial } = checkPasswordCriteria(password);

  return (
    <div
      role="status"
      aria-live="polite"
      className={`p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-1.5 text-xs text-slate-600 ${className}`}
    >
      <div className="font-semibold text-slate-700 mb-1">Password Requirements:</div>

      <div className="flex items-center space-x-2">
        {hasMinLength ? (
          <Check className="h-4 w-4 text-emerald-600 flex-shrink-0" aria-hidden="true" />
        ) : (
          <Circle className="h-4 w-4 text-slate-400 flex-shrink-0" aria-hidden="true" />
        )}
        <span className={hasMinLength ? "text-emerald-700 font-medium" : ""}>
          More than 8 characters (at least 9 characters)
        </span>
      </div>

      <div className="flex items-center space-x-2">
        {hasUppercase ? (
          <Check className="h-4 w-4 text-emerald-600 flex-shrink-0" aria-hidden="true" />
        ) : (
          <Circle className="h-4 w-4 text-slate-400 flex-shrink-0" aria-hidden="true" />
        )}
        <span className={hasUppercase ? "text-emerald-700 font-medium" : ""}>
          At least one uppercase letter (A-Z)
        </span>
      </div>

      <div className="flex items-center space-x-2">
        {hasLowercase ? (
          <Check className="h-4 w-4 text-emerald-600 flex-shrink-0" aria-hidden="true" />
        ) : (
          <Circle className="h-4 w-4 text-slate-400 flex-shrink-0" aria-hidden="true" />
        )}
        <span className={hasLowercase ? "text-emerald-700 font-medium" : ""}>
          At least one lowercase letter (a-z)
        </span>
      </div>

      <div className="flex items-center space-x-2">
        {hasSpecial ? (
          <Check className="h-4 w-4 text-emerald-600 flex-shrink-0" aria-hidden="true" />
        ) : (
          <Circle className="h-4 w-4 text-slate-400 flex-shrink-0" aria-hidden="true" />
        )}
        <span className={hasSpecial ? "text-emerald-700 font-medium" : ""}>
          At least one special character (!@#$%^&* etc.)
        </span>
      </div>
    </div>
  );
}
