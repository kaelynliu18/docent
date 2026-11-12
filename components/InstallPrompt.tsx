"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

type BIPEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
const KEY = "docent-install-dismissed";

/**
 * Suggest installing to the home screen, once, on phones that aren't already
 * running the installed app. Android/Chrome gets the native prompt; iOS
 * Safari gets the two-step Share → Add to Home Screen hint.
 */
export function InstallPrompt() {
  const [mode, setMode] = useState<"android" | "ios" | null>(null);
  const [evt, setEvt] = useState<BIPEvent | null>(null);
  const path = usePathname();
  // Only on browsing screens, never mid-task (ranking, adding photos, identifying).
  const calm = path === "/" || path === "/visits" || path === "/list" || path === "/museums";

  useEffect(() => {
    const standalone = matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone;
    let dismissed = false;
    try {
      dismissed = !!localStorage.getItem(KEY);
    } catch {}
    if (standalone || dismissed || !matchMedia("(max-width: 767px)").matches) return;
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && /safari/i.test(navigator.userAgent) && !/crios|fxios/i.test(navigator.userAgent);
    const t = window.setTimeout(() => ios && setMode("ios"), 4000);
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setEvt(e as BIPEvent);
      setMode("android");
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("beforeinstallprompt", onPrompt);
    };
  }, []);

  const close = () => {
    try {
      localStorage.setItem(KEY, "1");
    } catch {}
    setMode(null);
  };

  if (!mode || !calm) return null;
  return (
    <div className="fade-in fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] z-50 rounded-2xl border border-line bg-surface p-4 shadow-hung md:hidden">
      <p className="font-serif text-lg leading-snug">Put Docent on your home screen</p>
      <p className="mt-1 text-sm text-ink-2">
        {mode === "ios" ? (
          <>
            Tap{" "}
            <svg className="inline size-4 align-[-2px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-label="Share">
              <path d="M12 3v12M8 7l4-4 4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
            </svg>{" "}
            Share, then <b className="font-medium text-ink">Add to Home Screen</b>. It opens full screen, like an app.
          </>
        ) : (
          "It opens full screen, like an app, and can remind you to rank after a visit."
        )}
      </p>
      <div className="mt-3 flex gap-2">
        {mode === "android" && evt && (
          <button
            type="button"
            onClick={async () => {
              await evt.prompt();
              close();
            }}
            className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-wall"
          >
            Install
          </button>
        )}
        <button type="button" onClick={close} className="rounded-full px-3 py-2 text-sm text-ink-2">
          Not now
        </button>
      </div>
    </div>
  );
}
