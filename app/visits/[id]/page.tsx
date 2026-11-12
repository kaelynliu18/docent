import { notFound } from "next/navigation";
import { getDb } from "@/lib/db/client";
import { currentUserId } from "@/lib/server/session";
import { getVisit } from "@/lib/server/visits";
import { VisitClient } from "./VisitClient";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const v = await getVisit(await getDb(), await currentUserId(), (await params).id);
  return { title: v ? `${v.visit.museumName} · Visits · Docent` : "Visit · Docent" };
}

export default async function VisitPage({ params }: { params: Promise<{ id: string }> }) {
  const v = await getVisit(await getDb(), await currentUserId(), (await params).id);
  if (!v) notFound();
  return <VisitClient initial={v} />;
}
