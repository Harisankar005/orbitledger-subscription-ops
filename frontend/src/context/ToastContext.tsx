import React, { createContext, useContext, useState, useCallback, ReactNode } from "react";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";

export type ToastType = "success" | "error" | "info";

export interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastContextValue {
  toast: {
    success: (message: string) => void;
    error: (message: string) => void;
    info: (message: string) => void;
  };
  showToast: (message: string, type?: ToastType) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (message: string, type: ToastType = "info") => {
      const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      setToasts((prev) => [...prev, { id, message, type }]);

      setTimeout(() => {
        removeToast(id);
      }, 4000);
    },
    [removeToast]
  );

  const toast = {
    success: (msg: string) => showToast(msg, "success"),
    error: (msg: string) => showToast(msg, "error"),
    info: (msg: string) => showToast(msg, "info"),
  };

  return (
    <ToastContext.Provider value={{ toast, showToast, removeToast }}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={removeToast} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return {
    ...ctx.toast,
    toast: ctx.toast,
    showToast: ctx.showToast,
    removeToast: ctx.removeToast,
  };
}

function ToastContainer({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}) {
  return (
    <aside
      role="region"
      aria-label="Notifications"
      className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none px-4 sm:px-0"
    >
      {toasts.map((t) => {
        const isAssertive = t.type === "error";
        return (
          <div
            key={t.id}
            role={isAssertive ? "alert" : "status"}
            aria-live={isAssertive ? "assertive" : "polite"}
            aria-atomic="true"
            className={`pointer-events-auto flex items-start gap-3 p-3.5 rounded-lg shadow-lg border text-sm transition-all transform animate-in slide-in-from-bottom-2 duration-200 ${
              t.type === "success"
                ? "bg-emerald-50 border-emerald-200 text-emerald-900"
                : t.type === "error"
                ? "bg-rose-50 border-rose-200 text-rose-900"
                : "bg-slate-900 border-slate-800 text-white"
            }`}
          >
            <div className="flex-shrink-0 mt-0.5">
              {t.type === "success" && <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />}
              {t.type === "error" && <AlertCircle className="h-4 w-4 text-rose-600" aria-hidden="true" />}
              {t.type === "info" && <Info className="h-4 w-4 text-indigo-400" aria-hidden="true" />}
            </div>

            <div className="flex-1 font-medium text-xs sm:text-sm">{t.message}</div>

            <button
              type="button"
              onClick={() => onDismiss(t.id)}
              className="flex-shrink-0 rounded p-1 hover:bg-black/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 transition-colors"
              aria-label="Dismiss notification"
            >
              <X className="h-3.5 w-3.5 opacity-60 hover:opacity-100" />
            </button>
          </div>
        );
      })}
    </aside>
  );
}
