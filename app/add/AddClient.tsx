"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import exifr from "exifr";
import { groupPhotos, localDay } from "@/lib/algo/visitGroups";
import { usePicked } from "@/lib/client/picked";
import { enqueue } from "@/lib/client/uploadQueue";
import { formatDay, todayLocal } from "@/lib/client/dates";
import { MuseumPicker, type PickerMuseum } from "@/components/MuseumPicker";

type Photo = { id: string; file: File; url: string; day: string | null; lat: number | null; lon: number | null; dated: boolean };
type Group = {
  key: string;
  ids: string[];
  day: string;
  museum: PickerMuseum | null;
  how: "photo-location" | "your-location" | "picked" | null;
  include: boolean;
};

/**
 * Photo-first visit logging. Reads each photo's own date and location (in the
 * browser, before upload strips them), groups photos into visits, suggests the
 * museum, and asks only for what it couldn't work out.
 */
export function AddClient() {
  const router = useRouter();
  const picked = usePicked((s) => s.files);
  const clearPicked = usePicked((s) => s.clear);
  const [photos, setPhotos] = useState<Photo[] | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [choosing, setChoosing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  /* Read metadata for the picked files. */
  const load = async (files: File[]) => {
    setPhotos(null);
    setError(null);
    const out = await Promise.all(
      files.map(async (file, i) => {
        const [gps, meta] = await Promise.all([
          exifr.gps(file).catch(() => null),
          exifr.parse(file, ["DateTimeOriginal", "CreateDate"]).catch(() => null) as Promise<{ DateTimeOriginal?: Date; CreateDate?: Date } | null>,
        ]);
        const taken = meta?.DateTimeOriginal ?? meta?.CreateDate ?? null;
        const ok = (n: unknown) => typeof n === "number" && Number.isFinite(n);
        return {
          id: `${i}-${file.name}-${file.size}`,
          file,
          url: URL.createObjectURL(file),
          day: taken instanceof Date && !Number.isNaN(taken.getTime()) ? localDay(taken) : null,
          lat: gps && ok(gps.latitude) ? gps.latitude : null,
          lon: gps && ok(gps.longitude) ? gps.longitude : null,
          dated: taken instanceof Date,
        } satisfies Photo;
      }),
    );
    setPhotos(out);

    const raw = groupPhotos(out.map(({ id, day, lat, lon }) => ({ id, day, lat, lon })));
    const located = raw.filter((g) => g.lat != null);
    const near = located.length
      ? await fetch("/api/museums/nearest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ points: located.map((g) => ({ lat: g.lat, lon: g.lon })) }),
        })
          .then((r) => (r.ok ? r.json() : []))
          .catch(() => [])
      : [];
    const next: Group[] = raw.map((g, i) => {
      const hit = g.lat != null ? near[located.indexOf(g)] : null;
      return {
        key: `g${i}`,
        ids: g.ids,
        day: g.day ?? todayLocal(),
        museum: hit?.museum ?? null,
        how: hit?.museum ? "photo-location" : null,
        include: true,
      };
    });
    setGroups(next);

    // Taken today but no location in the photo (iOS often strips it): you're probably still there.
    const today = next.find((g) => !g.museum && g.day === todayLocal());
    if (today && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          const r = await fetch("/api/museums/nearest", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ points: [{ lat: pos.coords.latitude, lon: pos.coords.longitude }] }),
          }).catch(() => null);
          const [hit] = r?.ok ? await r.json() : [null];
          if (hit?.museum) setGroups((gs) => gs.map((g) => (g.key === today.key && !g.museum ? { ...g, museum: hit.museum, how: "your-location" } : g)));
        },
        () => {},
        { timeout: 8000, maximumAge: 300_000 },
      );
    }
  };

  useEffect(() => {
    if (picked.length) load(picked);
  }, [picked]);

  useEffect(() => () => photos?.forEach((p) => URL.revokeObjectURL(p.url)), [photos]);

  const byId = useMemo(() => new Map((photos ?? []).map((p) => [p.id, p])), [photos]);
  const included = groups.filter((g) => g.include);
  const ready = included.length > 0 && included.every((g) => g.museum);
  const photoCount = included.reduce((n, g) => n + g.ids.length, 0);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const visitIds: string[] = [];
      for (const g of included) {
        const r = await fetch("/api/visits", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ museumId: g.museum!.id, visitedOn: g.day }),
        });
        const body = await r.json().catch(() => null);
        if (!r.ok) throw new Error(body?.error?.message ?? "Couldn't save that visit. Try again.");
        visitIds.push(body.id);
        await enqueue(body.id, g.ids.map((id) => byId.get(id)!.file));
      }
      clearPicked();
      router.push(visitIds.length === 1 ? `/visits/${visitIds[0]}` : "/visits");
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const update = (key: string, patch: Partial<Group>) => setGroups((gs) => gs.map((g) => (g.key === key ? { ...g, ...patch } : g)));

  const chooser = (
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
        if (files.length) usePicked.getState().set(files);
      }}
    />
  );

  if (!picked.length) {
    return (
      <section className="mx-auto max-w-md py-20 text-center">
        <h1 className="font-serif text-4xl">Add your museum photos</h1>
        <p className="mt-3 text-ink-2">
          Pick the photos you took. We&apos;ll use when and where they were taken to work out which museum visit they belong to.
        </p>
        <button type="button" onClick={() => input.current?.click()} className="mt-8 rounded-full bg-ink px-6 py-3 font-medium text-wall">
          Choose photos
        </button>
        {chooser}
        <p className="mt-6 text-sm text-ink-2">
          Prefer to start from the museum?{" "}
          <Link href="/visits/new" className="text-ink underline decoration-line underline-offset-4">
            Log a visit
          </Link>
        </p>
        <p className="mt-2 text-sm text-ink-2">
          Just want to know what a painting is?{" "}
          <Link href="/scan" className="text-ink underline decoration-line underline-offset-4">
            Scan it
          </Link>
        </p>
      </section>
    );
  }

  if (!photos) {
    return (
      <section className="mx-auto max-w-md py-24 text-center">
        <p className="font-serif text-2xl">Reading {picked.length} photos…</p>
      </section>
    );
  }

  const choosingGroup = groups.find((g) => g.key === choosing);

  return (
    <section className="mx-auto max-w-2xl pb-40 pt-2">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => {
            clearPicked();
            router.back();
          }}
          className="-ml-2 rounded-full px-2 py-1 text-sm text-ink-2 hover:text-ink"
        >
          Cancel
        </button>
        <button type="button" onClick={() => input.current?.click()} className="rounded-full px-2 py-1 text-sm text-ink-2 hover:text-ink">
          Choose different photos
        </button>
        {chooser}
      </div>
      <h1 className="mt-3 font-serif text-4xl leading-tight">
        {groups.length === 1 ? "One visit" : `${groups.length} visits`}, {photos.length} {photos.length === 1 ? "photo" : "photos"}
      </h1>
      <p className="mt-2 text-ink-2">
        {groups.every((g) => g.museum) ? "Check these look right, then add them." : "Tell us where the rest were taken."}
      </p>

      <ol className="mt-8 flex flex-col gap-5">
        {groups.map((g) => {
          const shown = g.ids.slice(0, 8);
          return (
            <li key={g.key} className={`rounded-3xl border bg-surface p-4 transition-opacity sm:p-5 ${g.museum || !g.include ? "border-line" : "border-ink"} ${g.include ? "" : "opacity-50"}`}>
              <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
                {shown.map((id) => (
                  <img key={id} src={byId.get(id)!.url} alt="" className="h-20 w-auto shrink-0 rounded-md object-cover shadow-sm" />
                ))}
                {g.ids.length > shown.length && (
                  <span className="grid h-20 w-16 shrink-0 place-items-center rounded-md bg-wall text-sm text-ink-2">+{g.ids.length - shown.length}</span>
                )}
              </div>

              <button type="button" onClick={() => setChoosing(g.key)} disabled={!g.include} className="mt-4 flex w-full items-center justify-between gap-3 text-left">
                <span className="min-w-0">
                  {g.museum ? (
                    <>
                      <span className="block truncate font-serif text-2xl leading-tight">{g.museum.name}</span>
                      <span className="block text-sm text-ink-2">
                        {g.how === "photo-location" ? "From where the photos were taken" : g.how === "your-location" ? "From where you are now" : [g.museum.city, g.museum.country].filter(Boolean).join(", ")}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="block font-serif text-2xl leading-tight">Which museum?</span>
                      <span className="block text-sm text-ink-2">These photos don&apos;t say where they were taken</span>
                    </>
                  )}
                </span>
                <span className="shrink-0 rounded-full border border-line px-3 py-1.5 text-sm">{g.museum ? "Change" : "Choose"}</span>
              </button>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
                <label className="flex items-center gap-2 text-sm text-ink-2">
                  <span>Visited</span>
                  <input
                    type="date"
                    value={g.day}
                    max={todayLocal()}
                    disabled={!g.include}
                    onChange={(e) => e.target.value && update(g.key, { day: e.target.value })}
                    className="rounded-full border border-line bg-wall px-3 py-1.5 text-base tabular-nums text-ink outline-none focus:border-ink-2"
                    aria-label={`Date for ${g.museum?.name ?? "this group"}, ${formatDay(g.day)}`}
                  />
                </label>
                <span className="text-sm text-ink-2">
                  {g.ids.length} {g.ids.length === 1 ? "photo" : "photos"}
                  {groups.length > 1 && (
                    <>
                      {" · "}
                      <button type="button" onClick={() => update(g.key, { include: !g.include })} className="underline underline-offset-2 hover:text-ink">
                        {g.include ? "Leave out" : "Include"}
                      </button>
                    </>
                  )}
                </span>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-wall/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 py-3">
          {error ? (
            <p role="alert" className="text-sm text-accent">{error}</p>
          ) : (
            <p className="text-sm leading-snug text-ink-2">
              {ready ? "Photos upload in the background, even if you lose signal." : "Choose a museum for each group."}
            </p>
          )}
          <button
            type="button"
            disabled={!ready || busy}
            onClick={submit}
            className="shrink-0 whitespace-nowrap rounded-full bg-ink px-5 py-3 text-sm font-medium text-wall transition-opacity disabled:opacity-40"
          >
            {busy ? "Adding…" : `Add ${photoCount} ${photoCount === 1 ? "photo" : "photos"}`}
          </button>
        </div>
      </div>

      {choosingGroup && (
        <div role="dialog" aria-modal="true" aria-label="Choose the museum" className="fade-in fixed inset-0 z-50 overflow-y-auto bg-wall px-4 pb-[calc(env(safe-area-inset-bottom)+2rem)] pt-[max(1rem,env(safe-area-inset-top))]">
          <div className="mx-auto max-w-2xl">
            <div className="flex items-center justify-between">
              <h2 className="font-serif text-3xl">Which museum?</h2>
              <button type="button" onClick={() => setChoosing(null)} className="rounded-full px-3 py-2 text-sm text-ink-2 hover:text-ink">
                Cancel
              </button>
            </div>
            <p className="mb-5 mt-1 text-sm text-ink-2">
              {choosingGroup.ids.length} {choosingGroup.ids.length === 1 ? "photo" : "photos"} from {formatDay(choosingGroup.day)}
            </p>
            <MuseumPicker
              onPick={(m) => {
                update(choosingGroup.key, { museum: m, how: "picked" });
                setChoosing(null);
              }}
            />
          </div>
        </div>
      )}
    </section>
  );
}
