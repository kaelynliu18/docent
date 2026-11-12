ALTER TABLE "artworks" ADD COLUMN "nudity" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "hide_nudity" boolean DEFAULT false NOT NULL;