CREATE TYPE "public"."artwork_movement_source" AS ENUM('artwork', 'artist');--> statement-breakpoint
CREATE TYPE "public"."museum_mark_status" AS ENUM('visited', 'want');--> statement-breakpoint
CREATE TYPE "public"."tier" AS ENUM('loved', 'fine', 'meh');--> statement-breakpoint
CREATE TABLE "artist_movements" (
	"artist_id" text NOT NULL,
	"movement_id" text NOT NULL,
	CONSTRAINT "artist_movements_artist_id_movement_id_pk" PRIMARY KEY("artist_id","movement_id")
);
--> statement-breakpoint
CREATE TABLE "artists" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"birth_year" integer,
	"death_year" integer,
	"sitelinks" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artwork_movements" (
	"artwork_id" text NOT NULL,
	"movement_id" text NOT NULL,
	"source" "artwork_movement_source" NOT NULL,
	CONSTRAINT "artwork_movements_artwork_id_movement_id_pk" PRIMARY KEY("artwork_id","movement_id")
);
--> statement-breakpoint
CREATE TABLE "artworks" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"artist_id" text NOT NULL,
	"year" integer,
	"image_file" text,
	"sitelinks" integer DEFAULT 0 NOT NULL,
	"museum_id" text,
	"in_pool" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comparisons" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"winner_id" text NOT NULL,
	"loser_id" text NOT NULL,
	"was_tie" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingest_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"pass" text NOT NULL,
	"rows_upserted" integer DEFAULT 0 NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "movements" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "museum_artist_holdings" (
	"museum_id" text NOT NULL,
	"artist_id" text NOT NULL,
	"painting_count" integer NOT NULL,
	CONSTRAINT "museum_artist_holdings_museum_id_artist_id_pk" PRIMARY KEY("museum_id","artist_id")
);
--> statement-breakpoint
CREATE TABLE "museum_marks" (
	"user_id" uuid NOT NULL,
	"museum_id" text NOT NULL,
	"status" "museum_mark_status" NOT NULL,
	CONSTRAINT "museum_marks_user_id_museum_id_pk" PRIMARY KEY("user_id","museum_id")
);
--> statement-breakpoint
CREATE TABLE "museum_movement_holdings" (
	"museum_id" text NOT NULL,
	"movement_id" text NOT NULL,
	"painting_count" integer NOT NULL,
	CONSTRAINT "museum_movement_holdings_museum_id_movement_id_pk" PRIMARY KEY("museum_id","movement_id")
);
--> statement-breakpoint
CREATE TABLE "museums" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"city" text,
	"country" text,
	"lat" double precision,
	"lon" double precision,
	"website" text,
	"sitelinks" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rankings" (
	"user_id" uuid NOT NULL,
	"artwork_id" text NOT NULL,
	"tier" "tier" NOT NULL,
	"position" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rankings_user_id_artwork_id_pk" PRIMARY KEY("user_id","artwork_id")
);
--> statement-breakpoint
CREATE TABLE "skips" (
	"user_id" uuid NOT NULL,
	"artwork_id" text NOT NULL,
	"skipped_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skips_user_id_artwork_id_pk" PRIMARY KEY("user_id","artwork_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text,
	"display_name" text,
	"home_lat" double precision,
	"home_lon" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "artist_movements" ADD CONSTRAINT "artist_movements_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artist_movements" ADD CONSTRAINT "artist_movements_movement_id_movements_id_fk" FOREIGN KEY ("movement_id") REFERENCES "public"."movements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artwork_movements" ADD CONSTRAINT "artwork_movements_artwork_id_artworks_id_fk" FOREIGN KEY ("artwork_id") REFERENCES "public"."artworks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artwork_movements" ADD CONSTRAINT "artwork_movements_movement_id_movements_id_fk" FOREIGN KEY ("movement_id") REFERENCES "public"."movements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artworks" ADD CONSTRAINT "artworks_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artworks" ADD CONSTRAINT "artworks_museum_id_museums_id_fk" FOREIGN KEY ("museum_id") REFERENCES "public"."museums"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparisons" ADD CONSTRAINT "comparisons_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparisons" ADD CONSTRAINT "comparisons_winner_id_artworks_id_fk" FOREIGN KEY ("winner_id") REFERENCES "public"."artworks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparisons" ADD CONSTRAINT "comparisons_loser_id_artworks_id_fk" FOREIGN KEY ("loser_id") REFERENCES "public"."artworks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "museum_artist_holdings" ADD CONSTRAINT "museum_artist_holdings_museum_id_museums_id_fk" FOREIGN KEY ("museum_id") REFERENCES "public"."museums"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "museum_artist_holdings" ADD CONSTRAINT "museum_artist_holdings_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "museum_marks" ADD CONSTRAINT "museum_marks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "museum_marks" ADD CONSTRAINT "museum_marks_museum_id_museums_id_fk" FOREIGN KEY ("museum_id") REFERENCES "public"."museums"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "museum_movement_holdings" ADD CONSTRAINT "museum_movement_holdings_museum_id_museums_id_fk" FOREIGN KEY ("museum_id") REFERENCES "public"."museums"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "museum_movement_holdings" ADD CONSTRAINT "museum_movement_holdings_movement_id_movements_id_fk" FOREIGN KEY ("movement_id") REFERENCES "public"."movements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rankings" ADD CONSTRAINT "rankings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rankings" ADD CONSTRAINT "rankings_artwork_id_artworks_id_fk" FOREIGN KEY ("artwork_id") REFERENCES "public"."artworks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skips" ADD CONSTRAINT "skips_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skips" ADD CONSTRAINT "skips_artwork_id_artworks_id_fk" FOREIGN KEY ("artwork_id") REFERENCES "public"."artworks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "artworks_pool_idx" ON "artworks" USING btree ("in_pool","sitelinks");--> statement-breakpoint
CREATE INDEX "artworks_museum_idx" ON "artworks" USING btree ("museum_id");--> statement-breakpoint
CREATE INDEX "artworks_artist_idx" ON "artworks" USING btree ("artist_id");--> statement-breakpoint
CREATE INDEX "comparisons_user_idx" ON "comparisons" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "mah_artist_idx" ON "museum_artist_holdings" USING btree ("artist_id");--> statement-breakpoint
CREATE INDEX "mmh_movement_idx" ON "museum_movement_holdings" USING btree ("movement_id");--> statement-breakpoint
CREATE INDEX "museums_lat_lon_idx" ON "museums" USING btree ("lat","lon");--> statement-breakpoint
CREATE INDEX "rankings_user_tier_pos_idx" ON "rankings" USING btree ("user_id","tier","position");