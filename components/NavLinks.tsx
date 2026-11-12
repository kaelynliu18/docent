"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePendingCount } from "@/lib/client/usePending";

const LINKS = [
  { href: "/visits", label: "Visits" },
  { href: "/rank", label: "Rank" },
  { href: "/list", label: "My list" },
  { href: "/taste", label: "Taste" },
  { href: "/museums", label: "Museums" },
];

/** Desktop navigation (phones use the TabBar). */
export function NavLinks() {
  const path = usePathname();
  const pending = usePendingCount();
  return (
    <nav aria-label="Main" className="flex items-center gap-1 text-sm max-md:hidden">
      {LINKS.map((l) => {
        const active = path === l.href || path.startsWith(l.href + "/");
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={`flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 transition-colors ${
              active ? "bg-ink text-wall" : "text-ink-2 hover:text-ink"
            }`}
          >
            {l.label}
            {l.href === "/rank" && pending > 0 && (
              <span
                aria-hidden
                className="min-w-[18px] rounded-full bg-loved px-1 text-center text-[10px] font-semibold leading-[18px] text-accent-ink"
              >
                {pending > 99 ? "99+" : pending}
              </span>
            )}
            {l.href === "/rank" && pending > 0 && (
              <span className="sr-only">, {pending} to rank</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
