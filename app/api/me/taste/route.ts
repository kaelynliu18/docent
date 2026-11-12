import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { currentUserId } from "@/lib/server/session";
import { getTasteProfile } from "@/lib/server/data";
import { handle } from "@/lib/server/errors";

export const GET = handle(async () => NextResponse.json(await getTasteProfile(await getDb(), await currentUserId())));
