import React, { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Wifi, WifiOff } from "lucide-react";

export function LiveIndicator() {
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    let eventSource: EventSource | null = null;

    try {
      eventSource = new EventSource("/api/events");

      eventSource.onopen = () => {
        setIsConnected(true);
      };

      eventSource.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          // Invalidate affected queries on live backend event triggers
          if (["invoice.created", "payment.recorded", "billing.completed"].includes(payload.event)) {
            queryClient.invalidateQueries({ queryKey: ["reports"] });
            queryClient.invalidateQueries({ queryKey: ["invoices"] });
            queryClient.invalidateQueries({ queryKey: ["subscriptions"] });
            queryClient.invalidateQueries({ queryKey: ["payments"] });
          }
        } catch {
          // ignore parsing error
        }
      };

      eventSource.onerror = () => {
        setIsConnected(false);
      };
    } catch {
      setIsConnected(false);
    }

    return () => {
      if (eventSource) {
        eventSource.close();
      }
    };
  }, [queryClient]);

  return (
    <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-xs font-medium border bg-white border-slate-200 shadow-sm">
      <span className="relative flex h-2 w-2">
        {isConnected ? (
          <>
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </>
        ) : (
          <span className="relative inline-flex rounded-full h-2 w-2 bg-slate-400"></span>
        )}
      </span>
      <span className={isConnected ? "text-slate-700" : "text-slate-400"}>
        {isConnected ? "Live Data" : "Offline"}
      </span>
    </div>
  );
}
