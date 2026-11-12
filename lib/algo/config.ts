/**
 * Knobs for the visual-taste features (embeddings, recommendations, taste map,
 * photo recognition), in one place. Changing EMBEDDING.model or .version makes
 * `pnpm embed` re-embed everything: rows are keyed by model + version.
 */
export const EMBEDDING = {
  /** Open CLIP model run with transformers.js (ONNX, CPU in Node, WASM in the browser). */
  model: "Xenova/clip-vit-base-patch32",
  /** Bump to force a clean re-embed (e.g. new preprocessing). */
  version: "q8-v1",
  dtype: "q8" as const,
  dims: 512,
  /** Standard Commons thumbnail width (cached by Commons; CLIP resizes to 224). */
  thumbWidth: 330,
  /** Image downloads in flight during a backfill (Commons throttles bursts). */
  concurrency: 2,
};

export const RECS = {
  /** Default number of recommendations returned. */
  limit: 20,
  /** Candidates pulled by similarity before re-ranking. */
  candidates: 200,
  /** MMR trade-off: 1 = pure relevance, 0 = pure diversity. */
  mmrLambda: 0.75,
  /** Weight of image vs text embedding in hybrid similarity (1 = image only). */
  imageWeight: 0.7,
  /** Below this many rankings a user is "cold": content only, no CF. */
  coldMax: 5,
  /** Weight of the embedding score vs the trait (artist/movement/…) score for warm users. */
  embedBlend: 0.5,
};

export const MAP = {
  /** UMAP settings; the seed keeps the layout stable across runs. */
  seed: 42,
  neighbors: 15,
  minDist: 0.1,
  /** k-means clusters over the catalogue. */
  clusters: 14,
  /** A cluster is "unexplored" when it holds this share of the catalogue but none of your rankings. */
  unexploredMinShare: 0.03,
};

export const SCAN = {
  /** Matches shown for the user to confirm. */
  show: 5,
  /** Top cosine similarity below this → "not found", fall back to search. Tuned in docs/eval-results.md. */
  notFoundBelow: 0.62,
};

/** Which embedding a precomputed map belongs to (artwork_map.version). */
export const mapVersion = () => `${EMBEDDING.model}@${EMBEDDING.version}`;
