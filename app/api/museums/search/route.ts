import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { searchMuseums } from "@/lib/server/visits";
import { handle } from "@/lib/server/errors";

const q = z.object({
  q: z.string().max(80).optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lon: z.coerce.number().min(-180).max(180).optional(),
});

export const GET = handle(async (req: Request) => {
  const p = q.parse(Object.fromEntries(new URL(req.url).searchParams));
  return NextResponse.json(await searchMuseums(await getDb(), { q: p.q, lat: p.lat, lon: p.lon, limit: 20 }));
});
