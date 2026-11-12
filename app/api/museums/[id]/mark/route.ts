import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { requireUserId } from "@/lib/server/session";
import { setMuseumMark } from "@/lib/server/data";
import { handle } from "@/lib/server/errors";

const body = z.object({ status: z.enum(["visited", "want"]).nullable() });

export const PUT = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const { status } = body.parse(await req.json());
  await setMuseumMark(await getDb(), await requireUserId(), id, status);
  return new Response(null, { status: 204 });
});
