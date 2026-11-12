import { getDb } from "@/lib/db/client";
import { museumForPicker, searchMuseums } from "@/lib/server/visits";
import { NewVisit } from "./NewVisit";

export const dynamic = "force-dynamic";
export const metadata = { title: "Log a visit · Docent" };

export default async function NewVisitPage({ searchParams }: { searchParams: Promise<{ museum?: string }> }) {
  const { museum } = await searchParams;
  const db = await getDb();
  const popular = await searchMuseums(db, { limit: 12 });
  const preset = museum ? await museumForPicker(db, museum) : null;
  return <NewVisit popular={popular} preset={preset} />;
}
