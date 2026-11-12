import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { requireUserId } from "@/lib/server/session";
import { identifyCandidates } from "@/lib/server/visits";
import { handle } from "@/lib/server/errors";

const q = z.object({ q: z.string().max(100).optional(), scope: z.enum(["museum", "all"]).default("museum") });

export const GET = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const p = q.parse(Object.fromEntries(new URL(req.url).searchParams));
  const rows = await identifyCandidates(await getDb(), await requireUserId(), (await ctx.params).id, p);
  return NextResponse.json(rows);
});
