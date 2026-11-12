import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { currentUserId } from "@/lib/server/session";
import { getMuseumDetail } from "@/lib/server/data";
import { ApiError, handle } from "@/lib/server/errors";

export const GET = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const d = await getMuseumDetail(await getDb(), await currentUserId(), id);
  if (!d) throw new ApiError(404, "not_found", "We couldn't find that museum.");
  return NextResponse.json({
    museum: d.museum,
    mark: d.mark,
    works: d.works.map((w) => ({ artwork: { id: w.id, title: w.title, artistName: w.artistName, thumbUrl: w.thumbUrl }, predicted: w.predicted, confidence: w.confidence, myScore: w.myScore })),
  });
});
