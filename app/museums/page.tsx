import { getDb } from "@/lib/db/client";
import { currentUserId } from "@/lib/server/session";
import { getMuseumMatches } from "@/lib/server/data";
import { MuseumsClient } from "./MuseumsClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Next museum · Docent" };

export default async function MuseumsPage() {
  const initial = await getMuseumMatches(await getDb(), await currentUserId(), {});
  return <MuseumsClient initial={initial} />;
}
