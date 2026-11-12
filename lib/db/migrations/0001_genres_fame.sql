CREATE TABLE "artwork_genres" (
	"artwork_id" text NOT NULL,
	"genre_id" text NOT NULL,
	CONSTRAINT "artwork_genres_artwork_id_genre_id_pk" PRIMARY KEY("artwork_id","genre_id")
);
--> statement-breakpoint
CREATE TABLE "genres" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
DROP INDEX "artworks_pool_idx";--> statement-breakpoint
ALTER TABLE "artworks" ADD COLUMN "fame" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "artwork_genres" ADD CONSTRAINT "artwork_genres_artwork_id_artworks_id_fk" FOREIGN KEY ("artwork_id") REFERENCES "public"."artworks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artwork_genres" ADD CONSTRAINT "artwork_genres_genre_id_genres_id_fk" FOREIGN KEY ("genre_id") REFERENCES "public"."genres"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "artworks_pool_idx" ON "artworks" USING btree ("in_pool","fame");