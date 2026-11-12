"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePendingCount } from "@/lib/client/usePending";
import { AddPhotosButton } from "./AddPhotosButton";
import { IconList, IconMap, IconPlus, IconRank, IconVisits } from "./Icons";

const TABS = [
  { href: "/visits", label: "Visits", Icon: IconVisits },
  { href: "/rank", label: "Rank", Icon: IconRank },
  null, // the + button
  { href: "/list", label: "My list", Icon: IconList },
  { href: "/museums", label: "Museums", Icon: IconMap },
] as const;

/** Phone navigation: thumb-reach tabs with the main action in the middle. Hidden from md up. */
export function TabBar() {
  const path = usePathname();
  const pending = usePendingCount();
  if (path === "/add") return null;
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-wall/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
    >
      <ul className="mx-auto grid h-16 max-w-md grid-cols-5 items-center">
        {TABS.map((t) =>
          t === null ? (
            <li key="add" className="flex justify-center">
              <AddPhotosButton className="-mt-5 grid size-14 place-items-center rounded-full bg-ink text-wall shadow-hung transition-transform active:scale-95">
                <IconPlus className="size-7" />
              </AddPhotosButton>
            </li>
          ) : (
            <li key={t.href}>
              {(() => {
                const active = path === t.href || path.startsWith(t.href + "/");
                return (
                  <Link
                    href={t.href}
                    aria-current={active ? "page" : undefined}
                    className={`relative flex flex-col items-center gap-0.5 py-1.5 text-[11px] transition-colors ${active ? "text-ink" : "text-ink-2"}`}
                  >
                    <t.Icon className="size-6" />
                    <span className={active ? "font-medium" : ""}>{t.label}</span>
                    {t.href === "/rank" && pending > 0 && (
                      <span
                        aria-hidden
                        className="absolute left-1/2 top-0.5 ml-2 min-w-[18px] rounded-full bg-loved px-1 text-center text-[10px] font-semibold leading-[18px] text-accent-ink"
                      >
                        {pending > 99 ? "99+" : pending}
                      </span>
                    )}
                    {t.href === "/rank" && pending > 0 && (
                      <span className="sr-only">, {pending} to rank</span>
                    )}
                  </Link>
                );
              })()}
            </li>
          ),
        )}
      </ul>
    </nav>
  );
}
