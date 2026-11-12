"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { VisitPhoto } from "@/lib/server/visits";
import { ScoreBadge } from "@/components/ScoreBadge";
import { formatDay } from "@/lib/client/dates";
import { dismiss, enqueue, onUploaded, useUploads } from "@/lib/client/uploadQueue";
import { IdentifyDialog } from "./IdentifyDialog";

export type VisitData = {
  visit: { id: string; visitedOn: string; museumId: string; museumName: string; city: string | null; country: string | null };
  photos: VisitPhoto[];
  toIdentify: number;
  toRank: number;
};

export function VisitClient({ initial }: { initial: VisitData }) {
  const router = useRouter();
  const [data, setData] = useState(initial);
  const qc = useQueryClient();
  const queued = useUploads((s) => s.items).filter((i) => i.visitId === initial.visit.id);
  const offline = useUploads((s) => s.offline);
  const [unreadable, setUnreadable] = useState(0);
  const [identifying, setIdentifying] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const { visit, photos } = data;

  // Uploads finish close together; only the newest refresh may update the page.
  const latest = useRef(0);
  const refresh = useCallback(async () => {
    const mine = ++latest.current;
    const r = await fetch(`/api/visits/${visit.id}`, { cache: "no-store" });
    if (mine !== latest.current) return null;
    if (r.ok) {
      const next: VisitData = await r.json();
      setData(next);
      qc.invalidateQueries({ queryKey: ["pending"] });
      return next;
    }
    return null;
  }, [visit.id, qc]);

  /* Photos upload through the shared queue (survives lost signal); refresh as each one lands. */
  useEffect(() => onUploaded((id) => id === visit.id && void refresh()), [visit.id, refresh]);
  // Uploads can land between the server render and this listener; re-check on open and whenever the queue changes.
  const queuedCount = queued.length;
  useEffect(() => {
    void refresh();
  }, [queuedCount, refresh]);

  const upload = useCallback(
    async (files: File[]) => {
      const images = files.filter((f) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name));
      setUnreadable((await enqueue(visit.id, images)) + (files.length - images.length));
    },
    [visit.id],
  );

  /* Previews for photos still on their way up. */
  const previews = useMemo(() => queued.map((q) => ({ ...q, url: URL.createObjectURL(q.thumb) })), [queued.map((q) => q.id + (q.error ?? "")).join()]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => previews.forEach((p) => URL.revokeObjectURL(p.url)), [previews]);

  /* Drop photos anywhere on the page. */
  useEffect(() => {
    const over = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      e.preventDefault();
      setDragging(true);
    };
    const leave = (e: DragEvent) => {
      if (e.relatedTarget === null) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      e.preventDefault();
      setDragging(false);
      if (e.dataTransfer?.files.length) upload([...e.dataTransfer.files]);
    };
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, [upload]);

  const removeVisit = async () => {
    if (!window.confirm(`Delete this visit and its ${photos.length} photos? Rankings you've made stay on your list.`)) return;
    const r = await fetch(`/api/visits/${visit.id}`, { method: "DELETE" });
    if (r.ok) {
      router.push("/visits");
      router.refresh();
    }
  };

  const firstUnidentified = photos.find((p) => !p.artwork)?.id ?? null;
  const where = [visit.city, visit.country].filter(Boolean).join(", ");
  const empty = photos.length === 0 && queued.length === 0;

  return (
    <section className="pb-36 pt-4">
      <Link href="/visits" className="text-sm text-ink-2 hover:text-ink">
        ← Visits
      </Link>
      <header className="mt-3 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="font-serif text-4xl leading-tight sm:text-5xl">
            <Link href={`/museums/${visit.museumId}`} className="decoration-line underline-offset-8 hover:underline">
              {visit.museumName}
            </Link>
          </h1>
          <p className="mt-2 text-ink-2">
            <time dateTime={visit.visitedOn}>{formatDay(visit.visitedOn)}</time>
            {where && ` · ${where}`}
            {photos.length > 0 && ` · ${photos.length} ${photos.length === 1 ? "photo" : "photos"}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!empty && (
            <button
              type="button"
              onClick={() => input.current?.click()}
              className="rounded-full border border-line bg-surface px-4 py-2 text-sm transition-colors hover:border-ink-2"
            >
              Add photos
            </button>
          )}
          <button type="button" onClick={removeVisit} className="rounded-full px-3 py-2 text-sm text-ink-2 hover:text-accent">
            Delete visit
          </button>
        </div>
      </header>

      <input
        ref={input}
        type="file"
        accept="image/*,.heic,.heif"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          if (e.target.files?.length) upload([...e.target.files]);
          e.target.value = "";
        }}
      />

      {empty ? (
        <button
          type="button"
          onClick={() => input.current?.click()}
          className={`mt-10 flex w-full flex-col items-center justify-center rounded-3xl border-2 border-dashed px-6 py-20 text-center transition-colors ${
            dragging ? "border-ink bg-surface" : "border-line hover:border-ink-2 hover:bg-surface"
          }`}
        >
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" className="text-ink-2" aria-hidden>
            <rect x="3" y="5" width="18" height="14" rx="1.5" />
            <path d="m3 16 5-5 4 4 3-3 6 6" />
            <circle cx="16" cy="9" r="1.5" />
          </svg>
          <span className="mt-4 font-serif text-2xl">Add the photos you took</span>
          <span className="mt-2 max-w-sm text-ink-2">
            Pick them from your camera roll, or drop them here. Then tell us which painting each one shows.
          </span>
        </button>
      ) : (
        <ul className="mt-10 columns-2 gap-4 sm:columns-3 sm:gap-6 lg:columns-4">
          {photos.map((p) => (
            <li key={p.id} className="mb-6 break-inside-avoid">
              <button type="button" onClick={() => setIdentifying(p.id)} className="group block w-full text-left">
                <span className="block overflow-hidden" style={p.width && p.height ? { aspectRatio: `${p.width} / ${p.height}` } : undefined}>
                  <img
                    src={p.thumbUrl ?? ""}
                    alt={p.artwork ? `Your photo of ${p.artwork.title}` : "Your photo, not identified yet"}
                    loading="lazy"
                    className="painting block h-full w-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.02]"
                  />
                </span>
                {p.artwork ? (
                  <span className="mt-2.5 flex items-start justify-between gap-2">
                    <span className="min-w-0">
                      <i className="line-clamp-2 font-serif text-base leading-snug">{p.artwork.title}</i>
                      <span className="block truncate text-xs text-ink-2">{p.artwork.artistName}</span>
                    </span>
                    {p.score != null ? (
                      <ScoreBadge score={p.score} size="sm" />
                    ) : (
                      <span className="shrink-0 rounded-full border border-line px-2 py-0.5 text-[11px] text-ink-2">to rank</span>
                    )}
                  </span>
                ) : (
                  <span className="mt-2.5 inline-flex items-center gap-1.5 rounded-full bg-ink px-3 py-1 text-xs font-medium text-wall">
                    Which painting is this?
                  </span>
                )}
              </button>
            </li>
          ))}
          {previews.map((u) => (
            <li key={u.id} className="mb-6 break-inside-avoid">
              <img src={u.url} alt="" className={`block w-full ${u.error ? "opacity-30" : "animate-pulse opacity-60"}`} />
              <span className={`mt-2.5 block text-xs ${u.error ? "text-accent" : "text-ink-2"}`}>
                {u.error ?? (offline ? "Saved on this phone · uploads when you're online" : "Uploading…")}
              </span>
              {u.error && (
                <button type="button" onClick={() => dismiss(u.id)} className="text-xs text-ink-2 underline underline-offset-2 hover:text-ink">
                  Dismiss
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {unreadable > 0 && (
        <p role="alert" className="mt-4 text-sm text-accent">
          {unreadable} {unreadable === 1 ? "file wasn't a photo we could read" : "files weren't photos we could read"}. Try JPEG, PNG or HEIC.{" "}
          <button type="button" onClick={() => setUnreadable(0)} className="text-ink-2 underline underline-offset-2">
            OK
          </button>
        </p>
      )}

      {dragging && !empty && (
        <div className="pointer-events-none fixed inset-3 z-40 grid place-items-center rounded-3xl border-2 border-dashed border-ink bg-wall/80">
          <p className="font-serif text-3xl">Drop to add photos</p>
        </div>
      )}

      {(data.toIdentify > 0 || data.toRank > 0) && (
        <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+4rem)] z-30 border-t border-line bg-wall/95 backdrop-blur md:bottom-0">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
            <p className="text-sm leading-snug text-ink-2">
              {data.toIdentify > 0
                ? `${data.toIdentify} ${data.toIdentify === 1 ? "photo needs" : "photos need"} identifying`
                : "Everything's identified"}
            </p>
            <div className="flex items-center gap-2">
              {data.toIdentify > 0 && (
                <button
                  type="button"
                  onClick={() => setIdentifying(firstUnidentified)}
                  className={`whitespace-nowrap rounded-full px-4 py-2.5 text-sm font-medium ${
                    data.toRank > 0 ? "border border-line bg-surface hover:border-ink-2" : "bg-ink text-wall hover:opacity-90"
                  }`}
                >
                  Identify
                </button>
              )}
              {data.toRank > 0 && (
                <Link href={`/rank?visit=${visit.id}`} className="whitespace-nowrap rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-wall hover:opacity-90">
                  Rank {data.toRank}
                  <span className="max-sm:hidden"> {data.toRank === 1 ? "painting" : "paintings"}</span> →
                </Link>
              )}
            </div>
          </div>
        </div>
      )}

      {identifying && photos.some((p) => p.id === identifying) && (
        <IdentifyDialog
          key={identifying}
          visit={visit}
          photo={photos.find((p) => p.id === identifying)!}
          position={{ index: photos.findIndex((p) => p.id === identifying), total: photos.length }}
          onClose={() => setIdentifying(null)}
          onDone={async (advance) => {
            const next = await refresh();
            if (!advance || !next) return setIdentifying(null);
            // Next unidentified photo after this one (wrapping), never this one again.
            const at = photos.findIndex((p) => p.id === identifying);
            const order = [...photos.slice(at + 1), ...photos.slice(0, at)].map((p) => p.id);
            const open = new Set(next.photos.filter((p) => !p.artwork && p.id !== identifying).map((p) => p.id));
            setIdentifying(order.find((id) => open.has(id)) ?? null);
          }}
        />
      )}
    </section>
  );
}
