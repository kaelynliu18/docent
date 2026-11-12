"use client";

import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

type Account = { id: string; email: string | null; hasGoogle: boolean; isDemo: boolean; isGuest: boolean } | null;

export function AccountClient({
  account,
  can,
  vapidKey,
  notice,
}: {
  account: Account;
  can: { email: boolean; google: boolean; push: boolean };
  vapidKey: string | null;
  notice: string | null;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const signedIn = !!account?.email;
  /** After any account switch: drop cached per-user data (badge counts, tiers) and re-render the server pages. */
  const switched = (to?: string) => {
    qc.clear();
    if (to) router.push(to);
    router.refresh();
  };

  return (
    <section className="mx-auto max-w-lg pb-16 pt-4">
      <h1 className="font-serif text-4xl sm:text-5xl">{signedIn ? "Account" : "Save your visits"}</h1>
      {notice && <p className="mt-4 rounded-xl bg-surface px-4 py-3 text-sm">{notice}</p>}

      {account?.isDemo ? (
        <p className="mt-3 text-ink-2">
          You&apos;re in the shared demo account. You can rank its paintings, but adding visits and photos needs your own
          account. The demo resets every night.
        </p>
      ) : signedIn ? (
        <p className="mt-3 text-ink-2">
          Signed in as <span className="text-ink">{account!.email}</span>
          {account!.hasGoogle && " with Google"}. Your visits, photos and rankings are saved to your account.
        </p>
      ) : (
        <p className="mt-3 text-ink-2">
          Right now your visits live only in this browser. Sign in to keep them safe and use them on any device. Anything
          you&apos;ve already added comes with you.
        </p>
      )}

      {!signedIn && !account?.isDemo && <SignIn can={can} onDone={() => switched()} />}

      {account && !account.isDemo && can.push && vapidKey && <Notifications vapidKey={vapidKey} />}

      <div className="mt-12 flex flex-col gap-2 border-t border-line pt-6">
        {!signedIn && !account?.isDemo && (
          <Action
            label="Try the demo account"
            hint="20 visits and 25 rankings that lean Impressionist, so every screen has something to show."
            onClick={async () => {
              await fetch("/api/auth/demo", { method: "POST" });
              switched("/museums");
            }}
          />
        )}
        {account && (
          <Action
            label={account.isDemo ? "Leave the demo account" : signedIn ? "Sign out" : "Start over as a new guest"}
            hint={!signedIn && !account.isDemo ? "This browser forgets your current visits." : undefined}
            onClick={async () => {
              if (!signedIn && !account.isDemo && !window.confirm("Start over? Your visits in this browser will be lost unless you sign in first.")) return;
              await fetch("/api/auth/signout", { method: "POST" });
              switched("/");
            }}
          />
        )}
        {account && !account.isDemo && (
          <Action
            danger
            label="Delete account and data"
            hint="Permanently removes your visits, photos and rankings."
            onClick={async () => {
              if (!window.confirm("Delete your account, visits, photos and rankings? This can't be undone.")) return;
              const r = await fetch("/api/account", { method: "DELETE" });
              if (r.ok) switched("/");
            }}
          />
        )}
      </div>
    </section>
  );
}

function Action({ label, hint, onClick, danger }: { label: string; hint?: string; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick} className="rounded-xl px-1 py-3 text-left transition-colors hover:bg-surface">
      <span className={`block ${danger ? "text-accent" : "text-ink"}`}>{label}</span>
      {hint && <span className="block text-sm text-ink-2">{hint}</span>}
    </button>
  );
}

function SignIn({ can, onDone }: { can: { email: boolean; google: boolean }; onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);

  const post = async (path: string, body: object) => {
    setBusy(true);
    setError(null);
    const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await r.json().catch(() => null);
    setBusy(false);
    if (!r.ok) {
      setError(json?.error?.message ?? "Something went wrong. Try again.");
      return null;
    }
    return json;
  };

  if (!can.email && !can.google) {
    return (
      <p className="mt-8 rounded-xl border border-line bg-surface px-4 py-3 text-sm text-ink-2">
        Sign-in isn&apos;t set up on this server yet. Add <code>RESEND_API_KEY</code> (email codes) or the{" "}
        <code>GOOGLE_*</code> settings; see <code>.env.example</code>. In <code>pnpm dev</code>, email codes print to the terminal.
      </p>
    );
  }

  return (
    <div className="mt-8">
      {can.email &&
        (step === "email" ? (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const r = await post("/api/auth/email/start", { email });
              if (r) {
                setDevCode(r.devCode ?? null);
                setStep("code");
              }
            }}
            className="flex flex-col gap-3"
          >
            <label>
              <span className="text-sm text-ink-2">Email</span>
              <input
                type="email"
                required
                autoComplete="email"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-full border border-line bg-surface px-5 py-3 text-base outline-none focus:border-ink-2"
              />
            </label>
            <button type="submit" disabled={busy} className="rounded-full bg-ink px-6 py-3 font-medium text-wall disabled:opacity-50">
              {busy ? "Sending…" : "Email me a code"}
            </button>
          </form>
        ) : (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (await post("/api/auth/email/verify", { email, code })) onDone();
            }}
            className="flex flex-col gap-3"
          >
            <p className="text-sm text-ink-2">
              We sent a 6-digit code to <span className="text-ink">{email}</span>.{" "}
              <button type="button" onClick={() => setStep("email")} className="underline underline-offset-2">
                Change
              </button>
            </p>
            {devCode && <p className="rounded-lg bg-surface px-3 py-2 text-xs text-ink-2">Dev mode (no email provider): your code is {devCode}</p>}
            <label>
              <span className="sr-only">Code</span>
              <input
                required
                autoFocus
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                aria-label="6-digit code"
                className="w-full rounded-full border border-line bg-surface px-5 py-3 text-center text-2xl tracking-[0.5em] tabular-nums outline-none focus:border-ink-2"
              />
            </label>
            <button type="submit" disabled={busy || code.length !== 6} className="rounded-full bg-ink px-6 py-3 font-medium text-wall disabled:opacity-50">
              {busy ? "Checking…" : "Sign in"}
            </button>
          </form>
        ))}
      {can.google && (
        <>
          {can.email && <p className="my-4 text-center text-sm text-ink-2">or</p>}
          <a href="/api/auth/google" className="flex items-center justify-center gap-2 rounded-full border border-line bg-surface px-6 py-3 hover:border-ink-2">
            Continue with Google
          </a>
        </>
      )}
      {error && <p role="alert" className="mt-3 text-sm text-accent">{error}</p>}
    </div>
  );
}

const b64ToBytes = (b64: string) => {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

function Notifications({ vapidKey }: { vapidKey: string }) {
  const [state, setState] = useState<"loading" | "unsupported" | "needs-install" | "denied" | "off" | "on">("loading");

  useEffect(() => {
    (async () => {
      const standalone = matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone;
      const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) return setState(ios && !standalone ? "needs-install" : "unsupported");
      if (Notification.permission === "denied") return setState("denied");
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      setState(sub ? "on" : "off");
    })();
  }, []);

  const turnOn = async () => {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return setState(perm === "denied" ? "denied" : "off");
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(vapidKey) });
    const r = await fetch("/api/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sub.toJSON()) });
    setState(r.ok ? "on" : "off");
  };
  const turnOff = async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await fetch("/api/push", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) });
      await sub.unsubscribe();
    }
    setState("off");
  };

  const text: Record<typeof state, string> = {
    loading: "",
    unsupported: "This browser can't show notifications.",
    "needs-install": "On iPhone, add Docent to your Home Screen first (Share → Add to Home Screen), then turn this on from there.",
    denied: "Notifications are blocked for Docent in your settings.",
    off: "The day after a visit, we'll remind you if there are paintings left to rank.",
    on: "On. We'll remind you the day after a visit if there are paintings left to rank.",
  };

  return (
    <div className="mt-10 flex items-start justify-between gap-6 rounded-2xl border border-line bg-surface p-5">
      <div>
        <p className="font-medium">Reminders</p>
        <p className="mt-1 text-sm text-ink-2">{text[state]}</p>
      </div>
      {(state === "off" || state === "on") && (
        <button
          type="button"
          role="switch"
          aria-checked={state === "on"}
          aria-label="Reminders"
          onClick={state === "on" ? turnOff : turnOn}
          className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${state === "on" ? "bg-ink" : "bg-line"}`}
        >
          <span className={`absolute top-0.5 size-6 rounded-full bg-wall shadow transition-[left] ${state === "on" ? "left-[22px]" : "left-0.5"}`} />
        </button>
      )}
    </div>
  );
}
