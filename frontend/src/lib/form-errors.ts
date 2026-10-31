import { UseFormSetError, FieldValues, Path } from "react-hook-form";

export interface ServerApiError {
  code?: string;
  message?: string;
  fields?: Record<string, string>;
  request_id?: string;
}

export function handleServerErrors<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  toast?: { error: (msg: string) => void },
  fallbackMessage: string = "Operation failed. Please review the highlighted fields."
): string {
  const err = error as ServerApiError;
  let summaryMessage = "";

  if (err?.fields && typeof err.fields === "object") {
    for (const [field, message] of Object.entries(err.fields)) {
      if (typeof message === "string") {
        if (!summaryMessage) {
          summaryMessage = message;
        }
        setError(field as Path<T>, {
          type: "server",
          message,
        });
      }
    }
  }

  const finalMessage = summaryMessage || err?.message || fallbackMessage;
  if (toast) {
    toast.error(finalMessage);
  }
  return finalMessage;
}
