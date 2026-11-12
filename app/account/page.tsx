import { getDb } from "@/lib/db/client";
import { currentUserId } from "@/lib/server/session";
import { getAccount } from "@/lib/server/auth";
import { getPrefs } from "@/lib/server/data";
import { env, features } from "@/lib/env";
import { AccountClient } from "./AccountClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Account · Docent" };

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ error?: string; signed?: string }> }) {
  const sp = await searchParams;
  const db = await getDb();
  const uid = await currentUserId();
  const account = await getAccount(db, uid);
  const prefs = await getPrefs(db, uid);
  return (
    <AccountClient
      account={account}
      prefs={prefs}
      can={{ email: features.email(), google: features.google(), push: features.push() }}
      vapidKey={features.push() ? env().VAPID_PUBLIC_KEY! : null}
      notice={sp.error === "google" ? "Google sign-in didn't complete. Try again, or use email." : sp.signed ? "You're signed in." : null}
    />
  );
}
