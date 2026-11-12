export const metadata = { title: "Offline · Docent" };

/** Shown by the service worker when a page can't load. Static, so it's cached at install. */
export default function Offline() {
  return (
    <section className="mx-auto max-w-md py-24 text-center">
      <h1 className="font-serif text-4xl">You&apos;re offline</h1>
      <p className="mt-3 text-ink-2">
        Photos you&apos;ve already added are saved on this phone and will upload by themselves when you&apos;re back online.
      </p>
    </section>
  );
}
