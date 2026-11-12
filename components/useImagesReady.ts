"use client";

import { useEffect, useState } from "react";

const cache = new Map<string, Promise<void>>();

/** Starts loading an image once; resolves when decoded (or failed, so we never hang). */
export function preloadImage(src: string | null | undefined): Promise<void> {
  if (!src || typeof window === "undefined") return Promise.resolve();
  let p = cache.get(src);
  if (!p) {
    p = new Promise<void>((resolve) => {
      const img = new Image();
      img.onload = () => (img.decode ? img.decode().catch(() => {}).then(() => resolve()) : resolve());
      img.onerror = () => resolve();
      img.src = src;
    });
    cache.set(src, p);
  }
  return p;
}

/** True once every image is loaded, so comparison pairs appear together. */
export function useImagesReady(srcs: (string | null | undefined)[]): boolean {
  const key = srcs.join("|");
  const [readyKey, setReadyKey] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    Promise.all(srcs.map(preloadImage)).then(() => alive && setReadyKey(key));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return readyKey === key;
}
