"use client";

import { create } from "zustand";
import { preparePhoto } from "./photos";

/**
 * Uploads that survive museum Wi-Fi. Each photo is resized right away and the
 * small JPEGs are kept in IndexedDB until the server has them, so closing the
 * app, losing signal or a failed request never loses a photo. The runner
 * retries when the connection returns, when the app comes back to the
 * foreground, and on a backoff timer. Falls back to memory if IndexedDB is
 * unavailable (some private modes).
 */

type Item = {
  id: string;
  visitId: string;
  full: Blob;
  thumb: Blob;
  width: number;
  height: number;
  addedAt: number;
  error?: string; // set when the server refused it for good (not retried)
};

type QueueState = {
  items: { id: string; visitId: string; thumb: Blob; error?: string }[];
  active: number;
  offline: boolean;
  done: number; // uploaded this session, for "3 of 12"
};

export const useUploads = create<QueueState>(() => ({ items: [], active: 0, offline: false, done: 0 }));

const listeners = new Set<(visitId: string) => void>();
/** Called after each successful upload with its visit id. */
export function onUploaded(fn: (visitId: string) => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/* ───────── storage ───────── */

const DB_NAME = "docent-uploads";
const STORE = "queue";
let memory: Map<string, Item> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

let dbPromise: Promise<IDBDatabase | null> | null = null;
const idb = () => (dbPromise ??= openDb());

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  const db = await idb();
  if (!db) return undefined;
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function all(): Promise<Item[]> {
  if (memory) return [...memory.values()];
  const rows = await tx<Item[]>("readonly", (s) => s.getAll() as IDBRequest<Item[]>).catch(() => undefined);
  if (rows === undefined) {
    memory = new Map();
    return [];
  }
  return rows.sort((a, b) => a.addedAt - b.addedAt);
}
async function put(item: Item) {
  if (memory) return void memory.set(item.id, item);
  const ok = await tx("readwrite", (s) => s.put(item)).then(() => true, () => false);
  if (!ok) (memory ??= new Map()).set(item.id, item);
}
async function remove(id: string) {
  if (memory) return void memory.delete(id);
  await tx("readwrite", (s) => s.delete(id)).catch(() => undefined);
}

async function publish() {
  const items = await all();
  useUploads.setState({ items: items.map(({ id, visitId, thumb, error }) => ({ id, visitId, thumb, error })) });
}

/* ───────── public API ───────── */

/** Resize and queue photos for a visit. Returns how many couldn't be read. */
export async function enqueue(visitId: string, files: File[]) {
  let unreadable = 0;
  for (const f of files) {
    try {
      const p = await preparePhoto(f);
      await put({ id: crypto.randomUUID(), visitId, full: p.full, thumb: p.thumb, width: p.width, height: p.height, addedAt: Date.now() });
      await publish();
      void run();
    } catch {
      unreadable++;
    }
  }
  return unreadable;
}

export async function dismiss(id: string) {
  await remove(id);
  await publish();
}

export async function retryFailed() {
  for (const it of await all()) if (it.error) await put({ ...it, error: undefined });
  await publish();
  void run();
}

/* ───────── runner ───────── */

let running = false;
let backoff = 0;
let timer: number | undefined;

async function uploadOne(it: Item): Promise<"ok" | "offline" | "retry" | "refused"> {
  const form = new FormData();
  form.set("photo", it.full, "photo.jpg");
  form.set("thumb", it.thumb, "thumb.jpg");
  form.set("width", String(it.width));
  form.set("height", String(it.height));
  let r: Response;
  try {
    r = await fetch(`/api/visits/${it.visitId}/photos`, { method: "POST", body: form });
  } catch {
    return "offline"; // no connection or it dropped mid-upload
  }
  if (r.ok) return "ok";
  if (r.status === 429 || r.status >= 500) return "retry";
  const msg = (await r.json().catch(() => null))?.error?.message ?? "The server didn't accept this photo.";
  await put({ ...it, error: msg });
  return "refused";
}

export async function run() {
  if (running) return;
  running = true;
  window.clearTimeout(timer);
  try {
    for (;;) {
      // navigator.onLine is unreliable (it can say offline while online, and vice versa),
      // so always try; a failed request is what tells us we're offline.
      const todo = (await all()).filter((i) => !i.error);
      if (!todo.length) break;
      const batch = todo.slice(0, 2);
      useUploads.setState({ active: batch.length });
      const results = await Promise.all(
        batch.map(async (it) => {
          const res = await uploadOne(it);
          if (res === "ok") {
            useUploads.setState({ offline: false });
            await remove(it.id);
            useUploads.setState((s) => ({ done: s.done + 1 }));
            listeners.forEach((fn) => fn(it.visitId));
          }
          return res;
        }),
      );
      await publish();
      if (results.includes("offline")) useUploads.setState({ offline: true });
      if (results.includes("retry") || results.includes("offline")) {
        backoff = Math.min(60_000, backoff ? backoff * 2 : 4_000);
        timer = window.setTimeout(() => void run(), backoff);
        break;
      }
      backoff = 0;
    }
  } finally {
    running = false;
    useUploads.setState({ active: 0 });
    if (!(await all()).some((i) => !i.error)) useUploads.setState({ done: 0 });
  }
}

let started = false;
/** Start once per page load (from Providers): resume anything left from last time. */
export function startUploadQueue() {
  if (started || typeof window === "undefined") return;
  started = true;
  const kick = () => {
    backoff = 0;
    void run();
  };
  window.addEventListener("online", kick);
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && kick());
  void publish().then(kick);
}
