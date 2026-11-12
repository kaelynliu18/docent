import { getDb } from "@/lib/db/client";
import { currentUserId } from "@/lib/server/session";
import { deleteRanking } from "@/lib/server/data";
import { handle } from "@/lib/server/errors";

export const DELETE = handle(async (_req: Request, ctx: { params: Promise<{ artworkId: string }> }) => {
  const { artworkId } = await ctx.params;
  const userId = await currentUserId();
  if (userId) await deleteRanking(await getDb(), userId, artworkId);
  return new Response(null, { status: 204 });
});
