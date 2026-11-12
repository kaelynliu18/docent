import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchPageviews } from "@/lib/ingest/fame";

afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

describe("fetchPageviews", () => {
  it("follows pvipcontinue, resolves redirects, and retries after 429", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const u = new URL(url);
        calls.push(u.searchParams.get("pvipcontinue") ?? "first");
        if (calls.length === 2) return json({}, 429, { "retry-after": "0.01" });
        const base = {
          normalized: [{ from: "Nighthawks (painting)", to: "Nighthawks (painting)" }],
          redirects: [{ from: "Nighthawks (painting)", to: "Nighthawks (Hopper)" }],
        };
        if (!u.searchParams.get("pvipcontinue")) {
          return json({
            continue: { pvipcontinue: "B", continue: "||" },
            query: { ...base, pages: [{ title: "Mona Lisa", pageviews: { d1: 100, d2: 50 } }, { title: "Nighthawks (Hopper)" }] },
          });
        }
        return json({
          query: { ...base, pages: [{ title: "Mona Lisa" }, { title: "Nighthawks (Hopper)", pageviews: { d1: 7, d2: null } }] },
        });
      }),
    );
    const out = await fetchPageviews(
      new Map([
        ["Q1", "Mona_Lisa"],
        ["Q2", "Nighthawks_(painting)"],
      ]),
    );
    expect(out.get("Q1")).toBe(150);
    expect(out.get("Q2")).toBe(7);
    expect(calls).toEqual(["first", "B", "B"]); // 429 on the continuation, then retried
  }, 20_000);
});
