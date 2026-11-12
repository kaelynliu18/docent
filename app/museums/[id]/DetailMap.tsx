"use client";

import dynamic from "next/dynamic";
import type { Pin } from "@/components/MuseumMap";

const MuseumMap = dynamic(() => import("@/components/MuseumMap"), {
  ssr: false,
  loading: () => <div className="h-[260px] animate-pulse rounded-2xl border border-line bg-surface" />,
});

export function DetailMap({ pin }: { pin: Pin }) {
  return <MuseumMap pins={[pin]} height={260} />;
}
