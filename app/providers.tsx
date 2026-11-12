"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { onUploaded, startUploadQueue } from "@/lib/client/uploadQueue";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } } }),
  );

  useEffect(() => {
    startUploadQueue();
    const off = onUploaded(() => client.invalidateQueries({ queryKey: ["pending"] }));
    // Service worker: offline page, cached assets, and notifications. Production only, so dev never serves stale code.
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
    }
    return off;
  }, [client]);

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
