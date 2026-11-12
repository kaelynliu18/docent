"use client";

import { useRouter } from "next/navigation";
import { useRef } from "react";
import { usePicked } from "@/lib/client/picked";

/**
 * Opens the photo library straight away (one tap), then hands the picked
 * files to /add, which works out which museum and day they're from.
 */
export function AddPhotosButton({ className, children, label = "Add photos" }: { className?: string; children: React.ReactNode; label?: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const setPicked = usePicked((s) => s.set);
  return (
    <>
      <button type="button" aria-label={label} onClick={() => input.current?.click()} className={className}>
        {children}
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*,.heic,.heif"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          if (!files.length) return;
          setPicked(files);
          router.push("/add");
        }}
      />
    </>
  );
}
