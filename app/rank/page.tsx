import { getDb } from "@/lib/db/client";
import { currentUserId } from "@/lib/server/session";
import { getPending, getRankedList } from "@/lib/server/data";
import { RankClient } from "./RankClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Rank · Docent" };

/** Ranks only paintings the user photographed on a visit. ?visit= narrows to one visit; ?artwork= goes first. */
export default async function RankPage({ searchParams }: { searchParams: Promise<{ artwork?: string; visit?: string }> }) {
  const { artwork, visit } = await searchParams;
  const db = await getDb();
  const userId = await currentUserId();
  const list = await getRankedList(db, userId);
  const ranked = list.loved.length + list.fine.length + list.meh.length;
  const queue = await getPending(db, userId, { visitId: visit, first: artwork });
  return <RankClient initialQueue={queue} initialRanked={ranked} visitId={visit ?? null} />;
}
