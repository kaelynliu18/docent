import fs from "node:fs";
import path from "node:path";

export type Binding = Record<string, { type: string; value: string; "xml:lang"?: string }>;
export type SparqlJson = { results: { bindings: Binding[] } };

export class SparqlTimeout extends Error {}

/** Primary: the official Wikidata Query Service. */
export const WDQS = process.env.WIKIDATA_ENDPOINT ?? "https://query.wikidata.org/sparql";
/**
 * Fallback: QLever's public Wikidata mirror (free, no key). The pool query has
 * to scan every painting's sitelink count, which can exceed WDQS's limits under
 * load; QLever answers it in seconds. Set WIKIDATA_FALLBACK_ENDPOINT="" to disable.
 */
export const FALLBACK = process.env.WIKIDATA_FALLBACK_ENDPOINT ?? "https://qlever.dev/api/wikidata";

/** WDQS predefines these; QLever needs them spelled out. */
export const PREFIXES = `PREFIX wd: <http://www.wikidata.org/entity/>
PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX p: <http://www.wikidata.org/prop/>
PREFIX ps: <http://www.wikidata.org/prop/statement/>
PREFIX pq: <http://www.wikidata.org/prop/qualifier/>
PREFIX wikibase: <http://wikiba.se/ontology#>
PREFIX schema: <http://schema.org/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
`;

export function userAgent(): string {
  // Wikidata asks for a contact; set INGEST_USER_AGENT="Docent/1.0 (you@example.com)".
  return process.env.INGEST_USER_AGENT ?? "Docent/0.1 (art-ranking demo; set INGEST_USER_AGENT)";
}

/**
 * preferFallback: send straight to the fallback endpoint. Used for the pool
 * scan, which WDQS can't answer reliably (it has no index on sitelink counts).
 */
export type SparqlClient = (name: string, query: string, opts?: { preferFallback?: boolean }) => Promise<Binding[]>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One query at a time, a pause between queries, backoff on 429/503,
 * and a typed timeout so callers can split a batch and retry.
 * If recordDir is set, raw responses are saved for fixtures.
 */
export function createSparqlClient(opts: { recordDir?: string; pauseMs?: number } = {}): SparqlClient {
  let chain: Promise<unknown> = Promise.resolve();
  let n = 0;

  const run = async (name: string, query: string, endpoint: string): Promise<Binding[]> => {
    let transient = 0;
    for (let attempt = 0; attempt < 6; attempt++) {
      let res: Response;
      let text: string;
      try {
        res = await fetch(endpoint, {
          method: "POST",
          headers: {
            Accept: "application/sparql-results+json",
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": userAgent(),
          },
          body: new URLSearchParams({ query: PREFIXES + query }),
          signal: AbortSignal.timeout(70_000),
        });
        if (res.status === 429 || res.status === 503) {
          const retry = Number(res.headers.get("retry-after")) || 2 ** attempt * 5;
          await sleep(retry * 1000);
          continue;
        }
        text = await res.text();
      } catch {
        // Dropped connection mid-stream: usually the server-side timeout. Retry twice, then split.
        if (++transient > 1) throw new SparqlTimeout(name);
        await sleep(5000 * transient);
        continue;
      }
      if (!res.ok) {
        if (/TimeoutException|timeout/i.test(text)) throw new SparqlTimeout(name);
        throw new Error(`SPARQL ${name} failed: ${res.status} ${text.slice(0, 300)}`);
      }
      let json: SparqlJson;
      try {
        json = JSON.parse(text) as SparqlJson;
      } catch {
        // Truncated body (timeout after headers were sent).
        if (++transient > 1) throw new SparqlTimeout(name);
        await sleep(5000 * transient);
        continue;
      }
      if (opts.recordDir) {
        fs.mkdirSync(opts.recordDir, { recursive: true });
        fs.writeFileSync(path.join(opts.recordDir, `${String(++n).padStart(3, "0")}-${name}.json`), text);
      }
      await sleep(opts.pauseMs ?? 1000);
      return json.results.bindings;
    }
    throw new Error(`SPARQL ${name}: rate limited too many times`);
  };

  const withFallback = async (name: string, query: string, preferFallback = false) => {
    if (preferFallback && FALLBACK) {
      try {
        return await run(`${name}-fallback`, query, FALLBACK);
      } catch (e) {
        console.warn(`[ingest] ${name} failed on ${FALLBACK}; trying WDQS`, (e as Error).message);
        return run(name, query, WDQS);
      }
    }
    try {
      return await run(name, query, WDQS);
    } catch (e) {
      if (!(e instanceof SparqlTimeout) || !FALLBACK) throw e;
      console.warn(`[ingest] ${name} timed out on WDQS; retrying on ${FALLBACK}`);
      return run(`${name}-fallback`, query, FALLBACK);
    }
  };

  return (name, query, o) => {
    const p = chain.then(() => withFallback(name, query, o?.preferFallback));
    chain = p.catch(() => undefined);
    return p;
  };
}

/** Run a query over id batches; on timeout, halve the batch and retry. */
export async function batched<T>(
  ids: string[],
  size: number,
  fn: (batch: string[]) => Promise<T[]>,
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += size) {
    const batch = ids.slice(i, i + size);
    try {
      out.push(...(await fn(batch)));
    } catch (e) {
      if (e instanceof SparqlTimeout && batch.length > 1) {
        out.push(...(await batched(batch, Math.ceil(batch.length / 2), fn)));
      } else throw e;
    }
  }
  return out;
}
