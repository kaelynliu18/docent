import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { nearestMuseums } from "@/lib/server/visits";
import { handle } from "@/lib/server/errors";

const body = z.object({
  points: z.array(z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) })).min(1).max(50),
});

/** Which museum were these photos taken at? Coordinates come from the photos' own EXIF, read in the browser. */
export const POST = handle(async (req: Request) => {
  const { points } = body.parse(await req.json());
  return NextResponse.json(await nearestMuseums(await getDb(), points));
});
