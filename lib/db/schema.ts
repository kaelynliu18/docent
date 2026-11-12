import {
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/* ───────── Art data (written only by ingestion) ───────── */

export const artists = pgTable("artists", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  birthYear: integer("birth_year"),
  deathYear: integer("death_year"),
  sitelinks: integer("sitelinks").notNull().default(0),
});

export const movements = pgTable("movements", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
});

export const artistMovements = pgTable(
  "artist_movements",
  {
    artistId: text("artist_id").notNull().references(() => artists.id, { onDelete: "cascade" }),
    movementId: text("movement_id").notNull().references(() => movements.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.artistId, t.movementId] })],
);

export const museums = pgTable(
  "museums",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    city: text("city"),
    country: text("country"),
    lat: doublePrecision("lat"),
    lon: doublePrecision("lon"),
    website: text("website"),
    sitelinks: integer("sitelinks").notNull().default(0),
  },
  (t) => [index("museums_lat_lon_idx").on(t.lat, t.lon)],
);

export const artworks = pgTable(
  "artworks",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    artistId: text("artist_id").notNull().references(() => artists.id),
    year: integer("year"),
    imageFile: text("image_file"),
    sitelinks: integer("sitelinks").notNull().default(0),
    /** 0–1 blend of English Wikipedia pageviews and sitelinks percentiles. */
    fame: doublePrecision("fame").notNull().default(0),
    museumId: text("museum_id").references(() => museums.id, { onDelete: "set null" }),
    inPool: boolean("in_pool").notNull().default(false),
    /** Shows nudity: Wikidata depicts (P180) nudity/naked/nude… or genre nude/erotic art. */
    nudity: boolean("nudity").notNull().default(false),
    /** Set only for a painting a user added by hand (not in Wikidata); never shown to anyone else. */
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "cascade" }),
    /** Free-text artist for hand-added paintings (their artist_id is the UNKNOWN_ARTIST placeholder). */
    artistLabel: text("artist_label"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("artworks_pool_idx").on(t.inPool, t.fame),
    index("artworks_museum_idx").on(t.museumId),
    index("artworks_artist_idx").on(t.artistId),
    index("artworks_owner_idx").on(t.ownerId),
  ],
);

export const artworkMovementSource = pgEnum("artwork_movement_source", ["artwork", "artist"]);

export const artworkMovements = pgTable(
  "artwork_movements",
  {
    artworkId: text("artwork_id").notNull().references(() => artworks.id, { onDelete: "cascade" }),
    movementId: text("movement_id").notNull().references(() => movements.id, { onDelete: "cascade" }),
    source: artworkMovementSource("source").notNull(),
  },
  (t) => [primaryKey({ columns: [t.artworkId, t.movementId] })],
);

export const genres = pgTable("genres", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
});

export const artworkGenres = pgTable(
  "artwork_genres",
  {
    artworkId: text("artwork_id").notNull().references(() => artworks.id, { onDelete: "cascade" }),
    genreId: text("genre_id").notNull().references(() => genres.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.artworkId, t.genreId] })],
);

export const museumArtistHoldings = pgTable(
  "museum_artist_holdings",
  {
    museumId: text("museum_id").notNull().references(() => museums.id, { onDelete: "cascade" }),
    artistId: text("artist_id").notNull().references(() => artists.id, { onDelete: "cascade" }),
    paintingCount: integer("painting_count").notNull(),
  },
  (t) => [primaryKey({ columns: [t.museumId, t.artistId] }), index("mah_artist_idx").on(t.artistId)],
);

export const museumMovementHoldings = pgTable(
  "museum_movement_holdings",
  {
    museumId: text("museum_id").notNull().references(() => museums.id, { onDelete: "cascade" }),
    movementId: text("movement_id").notNull().references(() => movements.id, { onDelete: "cascade" }),
    paintingCount: integer("painting_count").notNull(),
  },
  (t) => [primaryKey({ columns: [t.museumId, t.movementId] }), index("mmh_movement_idx").on(t.movementId)],
);

export const ingestRuns = pgTable("ingest_runs", {
  id: serial("id").primaryKey(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  pass: text("pass").notNull(),
  rowsUpserted: integer("rows_upserted").notNull().default(0),
  error: text("error"),
});

/* ───────── User data ───────── */

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Lower-cased. Null for guests. */
  email: text("email").unique(),
  googleSub: text("google_sub").unique(),
  /** Never show nudity in suggestions, museum lists, or the catalogue (own photos still show). */
  hideNudity: boolean("hide_nudity").notNull().default(false),
  displayName: text("display_name"),
  homeLat: doublePrecision("home_lat"),
  homeLon: doublePrecision("home_lon"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tierEnum = pgEnum("tier", ["loved", "fine", "meh"]);

export const rankings = pgTable(
  "rankings",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    artworkId: text("artwork_id").notNull().references(() => artworks.id, { onDelete: "cascade" }),
    tier: tierEnum("tier").notNull(),
    /** Fractional index key; sorts with C collation so inserts never renumber rows. */
    position: text("position").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.artworkId] }),
    index("rankings_user_tier_pos_idx").on(t.userId, t.tier, t.position),
  ],
);

export const comparisons = pgTable(
  "comparisons",
  {
    id: serial("id").primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    winnerId: text("winner_id").notNull().references(() => artworks.id, { onDelete: "cascade" }),
    loserId: text("loser_id").notNull().references(() => artworks.id, { onDelete: "cascade" }),
    wasTie: boolean("was_tie").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("comparisons_user_idx").on(t.userId)],
);

export const skips = pgTable(
  "skips",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    artworkId: text("artwork_id").notNull().references(() => artworks.id, { onDelete: "cascade" }),
    skippedAt: timestamp("skipped_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.artworkId] })],
);

export const museumMarkStatus = pgEnum("museum_mark_status", ["visited", "want"]);

export const museumMarks = pgTable(
  "museum_marks",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    museumId: text("museum_id").notNull().references(() => museums.id, { onDelete: "cascade" }),
    status: museumMarkStatus("status").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.museumId] })],
);

/* ───────── Visits and photos ───────── */

export const visits = pgTable(
  "visits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    museumId: text("museum_id").notNull().references(() => museums.id),
    visitedOn: date("visited_on").notNull(),
    /** When we sent the "you have paintings to rank" reminder for this visit. */
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("visits_user_idx").on(t.userId, t.visitedOn)],
);

export const photos = pgTable(
  "photos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    visitId: uuid("visit_id").notNull().references(() => visits.id, { onDelete: "cascade" }),
    /** Which painting this photo shows; null until the user identifies it. */
    artworkId: text("artwork_id").references(() => artworks.id, { onDelete: "set null" }),
    /** Storage key of the uploaded JPEG; null for seeded demo photos (they use the Commons image). */
    storageKey: text("storage_key"),
    width: integer("width"),
    height: integer("height"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("photos_visit_idx").on(t.visitId), index("photos_user_artwork_idx").on(t.userId, t.artworkId)],
);

/* ───────── Accounts, limits, notifications ───────── */

/** Six-digit email sign-in codes. Only a hash is stored; codes expire and allow few attempts. */
export const loginCodes = pgTable(
  "login_codes",
  {
    id: serial("id").primaryKey(),
    email: text("email").notNull(),
    codeHash: text("code_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("login_codes_email_idx").on(t.email, t.createdAt)],
);

/** Sliding-window rate limiting without Redis: one row per event, pruned daily. */
export const rateEvents = pgTable(
  "rate_events",
  {
    id: serial("id").primaryKey(),
    key: text("key").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("rate_events_key_at_idx").on(t.key, t.at)],
);

export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    endpoint: text("endpoint").primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("push_user_idx").on(t.userId)],
);
