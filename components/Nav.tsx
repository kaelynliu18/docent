import Link from "next/link";
import { ThemeToggle } from "./ThemeToggle";
import { NavLinks } from "./NavLinks";
import { AddPhotosButton } from "./AddPhotosButton";
import { IconPlus, IconTaste, IconUser } from "./Icons";

export function Nav() {
  return (
    <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-2 px-4 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))] sm:gap-4 sm:px-6 md:py-4">
      <Link href="/" className="font-serif text-2xl tracking-tight">
        Docent
      </Link>
      <div className="flex items-center gap-1 sm:gap-2">
        <NavLinks />
        <AddPhotosButton className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 py-1.5 text-sm transition-colors hover:border-ink-2 max-md:hidden">
          <IconPlus className="size-4" />
          Add photos
        </AddPhotosButton>
        <Link href="/taste" aria-label="Your taste" className="grid size-9 place-items-center rounded-full text-ink-2 hover:text-ink md:hidden">
          <IconTaste className="size-[22px]" />
        </Link>
        <ThemeToggle />
        <Link href="/account" aria-label="Account" className="grid size-9 place-items-center rounded-full text-ink-2 hover:text-ink">
          <IconUser className="size-[22px]" />
        </Link>
      </div>
    </header>
  );
}
