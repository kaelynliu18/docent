"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { todayLocal } from "@/lib/client/dates";
import { MuseumPicker, type PickerMuseum } from "@/components/MuseumPicker";

export function NewVisit({ popular, preset }: { popular: PickerMuseum[]; preset: PickerMuseum | null }) {
  const router = useRouter();
  const [picked, setPicked] = useState<PickerMuseum | null>(preset);
  const [day, setDay] = useState(todayLocal());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!picked) return;
    setBusy(true);
    setError(null);
    const r = await fetch("/api/visits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ museumId: picked.id, visitedOn: day }),
    });
    const body = await r.json().catch(() => null);
    if (r.ok) return router.push(`/visits/${body.id}`);
    setError(body?.error?.message ?? "Something went wrong. Try again.");
    setBusy(false);
  };

  return (
    <section className="mx-auto max-w-2xl pb-16 pt-4">
      <h1 className="font-serif text-4xl sm:text-5xl">Log a visit</h1>
      <p className="mt-2 text-ink-2">Which museum did you go to?</p>

      <div className="mt-8">
        {picked ? (
          <div className="flex items-center justify-between gap-4 rounded-2xl border border-ink bg-surface px-5 py-4">
            <div className="min-w-0">
              <p className="font-serif text-2xl leading-tight">{picked.name}</p>
              <p className="mt-0.5 text-sm text-ink-2">{[picked.city, picked.country].filter(Boolean).join(", ")}</p>
            </div>
            <button type="button" onClick={() => setPicked(null)} className="shrink-0 rounded-full px-3 py-1.5 text-sm text-ink-2 hover:bg-wall hover:text-ink">
              Change
            </button>
          </div>
        ) : (
          <MuseumPicker initial={popular} onPick={setPicked} />
        )}
      </div>

      <div className="mt-8 flex flex-wrap items-end gap-4">
        <label className="block">
          <span className="text-sm text-ink-2">When did you go?</span>
          <input
            type="date"
            value={day}
            max={todayLocal()}
            onChange={(e) => setDay(e.target.value)}
            className="mt-1 block rounded-full border border-line bg-surface px-5 py-2.5 text-base tabular-nums outline-none focus:border-ink-2"
          />
        </label>
        <button
          type="button"
          disabled={!picked || !day || busy}
          onClick={submit}
          className="rounded-full bg-ink px-6 py-3 font-medium text-wall transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {busy ? "Saving…" : "Next: add your photos"}
        </button>
      </div>
      {error && <p role="alert" className="mt-4 text-sm text-accent">{error}</p>}
    </section>
  );
}
