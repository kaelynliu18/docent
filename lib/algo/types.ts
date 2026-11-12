export type Tier = "loved" | "fine" | "meh";
export const TIERS: Tier[] = ["loved", "fine", "meh"];

export const TIER_LABEL: Record<Tier, string> = {
  loved: "Loved it",
  fine: "It was fine",
  meh: "Not for me",
};

/** Placeholder artist for paintings a user adds by hand (not in Wikidata). */
export const UNKNOWN_ARTIST_ID = "X0";

/** Artists that must never shape taste. */
export const EXCLUDED_ARTIST_IDS = new Set<string>([
  "Q4233718", // anonymous
  "Q24238356", // unknown
  UNKNOWN_ARTIST_ID,
]);

/** Catalogue ids are Wikidata Q-ids; hand-added paintings are X + 32 hex chars. */
export const ARTWORK_ID_RE = /^(Q\d+|X[0-9a-f]{32})$/;

export type MovementRef = { id: string; name: string; source: "artwork" | "artist" };

export type GenreRef = { id: string; name: string };

export type RankedForTaste = {
  artworkId: string;
  artistId: string;
  artistName: string;
  score: number;
  movements: MovementRef[];
  genres?: GenreRef[];
  year?: number | null;
  /** Content tags that cut across genres, e.g. "nudity". */
  tags?: string[];
  /** Colour tags from the image (lookTags in look.ts), e.g. "warm", "muted". */
  looks?: string[];
  /** 1–3 moods from the image (MOODS in look.ts). */
  moods?: string[];
};

/** Content tags the app knows how to name. */
export const CONTENT_TAGS: Record<string, string> = { nudity: "Nudity" };

export type Affinity = { id: string; name: string; affinity: number; count: number };

export type TasteProfile = {
  artists: Map<string, Affinity>;
  movements: Map<string, Affinity>;
  /** Portrait, landscape, still life… (Wikidata P136; on ~94% of paintings). */
  genres: Map<string, Affinity>;
  /** Centuries, keyed "C19". Derived from the year. */
  periods: Map<string, Affinity>;
  /** Content tags (CONTENT_TAGS), learned only from paintings that carry them. */
  content: Map<string, Affinity>;
  /** Colour tags (LOOK_TAGS). */
  looks: Map<string, Affinity>;
  /** Moods (MOODS). */
  moods: Map<string, Affinity>;
  /** Each artist's ranked paintings as (year, weight), so a prediction can favour the same phase of a career. */
  artistWorks: Map<string, { year: number | null; w: number }[]>;
  /** This person's fitted trait weights (personal.ts); predictions use the defaults when absent. */
  weights?: Partial<Record<"artist" | "movement" | "genre" | "period" | "content" | "look" | "mood", number>>;
};

/** What the predictor and queue know about a painting. */
export type ArtworkFeatures = {
  artistId: string;
  movementIds: string[];
  genreIds?: string[];
  year?: number | null;
  tags?: string[];
  looks?: string[];
  moods?: string[];
};
