import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { currentUserId } from "@/lib/server/session";
import { getRecommendations } from "@/lib/server/data";
import { handle } from "@/lib/server/errors";
import { RECS } from "@/lib/algo/config";

/**
 * GET /api/recommendations?limit=20 → [{ artwork, score, reason }].
 * The user comes from the session cookie (never a query parameter).
 */
export const GET = handle(async (req: Request) => {
  const url = new URL(req.url);
  const limit = z.coerce.number().int().min(1).max(100).catch(RECS.limit).parse(url.searchParams.get("limit") ?? RECS.limit);
  const recs = await getRecommendations(await getDb(), await currentUserId(), limit);
  return NextResponse.json(
    recs.map((r) => ({
      artwork: { id: r.card.id, title: r.card.title, artistName: r.card.artistName, year: r.card.year, thumbUrl: r.card.thumbUrl, museum: r.card.museum },
      score: Math.round(r.score * 1000) / 1000,
      reason: r.reason,
    })),
  );
});
