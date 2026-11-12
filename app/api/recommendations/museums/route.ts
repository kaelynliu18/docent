import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { currentUserId } from "@/lib/server/session";
import { getMuseumMatches } from "@/lib/server/data";
import { handle } from "@/lib/server/errors";

const q = z.object({
  lat: z.coerce.number().min(-90).max(90).optional(),
  lon: z.coerce.number().min(-180).max(180).optional(),
  radiusKm: z.coerce.number().positive().max(20000).optional(),
  includeVisited: z.enum(["true", "false"]).optional(),
});

export const GET = handle(async (req: Request) => {
  const p = q.parse(Object.fromEntries(new URL(req.url).searchParams));
  const res = await getMuseumMatches(await getDb(), await currentUserId(), {
    lat: p.lat,
    lon: p.lon,
    radiusKm: p.lat != null && p.lon != null ? p.radiusKm : null,
    includeVisited: p.includeVisited === "true",
  });
  return NextResponse.json(res);
});
