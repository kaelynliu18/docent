"use client";

import { useState } from "react";

type Mark = "visited" | "want" | null;

export function MarkButtons({ museumId, initial }: { museumId: string; initial: Mark }) {
  const [mark, setMark] = useState<Mark>(initial);
  const set = async (next: Mark) => {
    const value = mark === next ? null : next;
    const prev = mark;
    setMark(value);
    const r = await fetch(`/api/museums/${museumId}/mark`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: value }),
    });
    if (!r.ok) setMark(prev);
  };
  const btn = (value: Exclude<Mark, null>, label: string) => (
    <button
      type="button"
      aria-pressed={mark === value}
      onClick={() => set(value)}
      className={`rounded-full border px-4 py-2 text-sm transition-colors ${
        mark === value ? "border-ink bg-ink text-wall" : "border-line bg-surface hover:border-ink-2"
      }`}
    >
      {mark === value ? "✓ " : ""}
      {label}
    </button>
  );
  return (
    <div className="flex gap-2">
      {btn("visited", "Been there")}
      {btn("want", "Want to go")}
    </div>
  );
}
