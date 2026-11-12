import { z } from "zod";
import { ARTWORK_ID_RE } from "@/lib/algo/types";
import { getDb } from "@/lib/db/client";
import { requireUserId } from "@/lib/server/session";
import { addSkip } from "@/lib/server/data";
import { handle } from "@/lib/server/errors";

const body = z.object({ artworkId: z.string().regex(ARTWORK_ID_RE) });

export const POST = handle(async (req: Request) => {
  const { artworkId } = body.parse(await req.json());
  await addSkip(await getDb(), await requireUserId(), artworkId);
  return new Response(null, { status: 204 });
});
