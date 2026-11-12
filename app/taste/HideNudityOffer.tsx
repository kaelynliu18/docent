"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Shown when rankings say "less nudity": offer to make it a rule. */
export function HideNudityOffer() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <p className="mt-4 rounded-xl border border-line bg-surface px-4 py-3 text-sm">
      You tend to rank paintings with nudity low.{" "}
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await fetch("/api/account", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hideNudity: true }) });
          router.refresh();
        }}
        className="font-medium underline underline-offset-2"
      >
        Hide nudity everywhere
      </button>
    </p>
  );
}
