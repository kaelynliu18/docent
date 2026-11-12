"use client";

import { useQuery } from "@tanstack/react-query";

/** How many photographed paintings are waiting to be ranked. Invalidate ["pending"] after ranking or uploading. */
export function usePendingCount() {
  const q = useQuery({
    queryKey: ["pending"],
    queryFn: async () => {
      const r = await fetch("/api/me/pending", { cache: "no-store" });
      return r.ok ? ((await r.json()) as { toRank: number }).toRank : 0;
    },
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });
  return q.data ?? 0;
}
