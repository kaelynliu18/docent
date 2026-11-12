"use client";

import { useState } from "react";

/** For people who chose to hide nudity: blurred until they ask to see it. */
export function Veiled({ src, alt }: { src: string; alt: string }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative overflow-hidden">
      <img
        src={src}
        alt={shown ? alt : "Hidden: contains nudity"}
        className={`painting max-h-[78vh] w-auto max-w-full object-contain transition-[filter] duration-300 ${shown ? "" : "blur-2xl"}`}
      />
      {!shown && (
        <div className="absolute inset-0 grid place-items-center">
          <div className="rounded-2xl bg-wall/90 px-5 py-4 text-center shadow-hung">
            <p className="text-sm">Contains nudity</p>
            <button type="button" onClick={() => setShown(true)} className="mt-2 rounded-full border border-line bg-surface px-4 py-1.5 text-sm hover:border-ink-2">
              Show anyway
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
