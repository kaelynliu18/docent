"use client";

import { usePathname } from "next/navigation";
import { retryFailed, useUploads } from "@/lib/client/uploadQueue";

/** A small pill above the tab bar while photos are uploading, waiting for signal, or failed. */
export function UploadStatus() {
  const { items, active, offline, done } = useUploads();
  const path = usePathname();
  const waiting = items.filter((i) => !i.error).length;
  const failed = items.filter((i) => i.error).length;
  if (!waiting && !failed) return null;
  // The add flow and visit pages show upload state inline.
  if (path === "/add" || (/^\/visits\/[0-9a-f-]{36}$/.test(path))) return null;

  let text: string;
  if (waiting && offline) text = `No connection · ${waiting} ${waiting === 1 ? "photo" : "photos"} saved, will upload`;
  else if (waiting) text = `Uploading ${done + 1} of ${done + waiting}…`;
  else text = `${failed} ${failed === 1 ? "photo" : "photos"} didn't upload`;

  return (
    <div
      role="status"
      className="fixed bottom-[calc(env(safe-area-inset-bottom)+5.25rem)] left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 whitespace-nowrap rounded-full bg-ink px-4 py-2 text-sm text-wall shadow-hung md:bottom-6"
    >
      {waiting > 0 && !offline && active > 0 && <span className="size-2 animate-pulse rounded-full bg-wall" aria-hidden />}
      <span>{text}</span>
      {!waiting && failed > 0 && (
        <button type="button" onClick={() => retryFailed()} className="font-medium underline underline-offset-2">
          Retry
        </button>
      )}
    </div>
  );
}
