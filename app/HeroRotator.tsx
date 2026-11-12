"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { preloadImage } from "@/components/useImagesReady";

type P = { id: string; title: string; artist: string; src: string | null };

export function HeroRotator({ paintings }: { paintings: P[] }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (paintings.length < 2 || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => {
      setI((x) => {
        const next = (x + 1) % paintings.length;
        preloadImage(paintings[(next + 1) % paintings.length].src);
        return next;
      });
    }, 4500);
    return () => clearInterval(t);
  }, [paintings]);
  const p = paintings[i];
  if (!p) return null;
  return (
    <figure className="flex flex-col items-center">
      <div className="flex h-[52vh] items-center justify-center">
        <img key={p.id} src={p.src ?? ""} alt={`${p.title} by ${p.artist}`} className="painting fade-in max-h-full w-auto max-w-full object-contain" />
      </div>
      <figcaption className="mt-4 text-center text-sm text-ink-2">
        <Link href={`/artwork/${p.id}`} className="hover:text-ink">
          <i className="font-serif text-base text-ink">{p.title}</i> · {p.artist}
        </Link>
      </figcaption>
    </figure>
  );
}
