"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export function RowMenu({ artworkId, title }: { artworkId: string; title: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const remove = async (thenRerank: boolean) => {
    setBusy(true);
    await fetch(`/api/rankings/${artworkId}`, { method: "DELETE" });
    if (thenRerank) router.push(`/rank?artwork=${artworkId}`);
    else router.refresh();
    setBusy(false);
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={`Options for ${title}`}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((o) => !o)}
        className="grid size-9 place-items-center rounded-full text-ink-2 hover:bg-wall hover:text-ink"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <circle cx="5" cy="12" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="19" cy="12" r="1.8" />
        </svg>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-20 mt-1 w-40 overflow-hidden rounded-xl border border-line bg-surface py-1 text-sm shadow-hung">
          <button role="menuitem" disabled={busy} onClick={() => remove(true)} className="block w-full px-4 py-2 text-left hover:bg-wall">
            Re-rank
          </button>
          <button role="menuitem" disabled={busy} onClick={() => remove(false)} className="block w-full px-4 py-2 text-left text-accent hover:bg-wall">
            Remove
          </button>
        </div>
      )}
    </div>
  );
}
