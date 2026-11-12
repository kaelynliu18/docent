CREATE TABLE "artwork_embeddings" (
	"artwork_id" text NOT NULL,
	"kind" text NOT NULL,
	"model" text NOT NULL,
	"version" text NOT NULL,
	"vector" real[],
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artwork_embeddings_artwork_id_kind_model_version_pk" PRIMARY KEY("artwork_id","kind","model","version")
);
--> statement-breakpoint
CREATE TABLE "artwork_map" (
	"artwork_id" text NOT NULL,
	"version" text NOT NULL,
	"x" real NOT NULL,
	"y" real NOT NULL,
	"cluster" integer NOT NULL,
	CONSTRAINT "artwork_map_artwork_id_version_pk" PRIMARY KEY("artwork_id","version")
);
--> statement-breakpoint
CREATE TABLE "map_clusters" (
	"version" text NOT NULL,
	"cluster" integer NOT NULL,
	"label" text NOT NULL,
	"x" real NOT NULL,
	"y" real NOT NULL,
	"size" integer NOT NULL,
	CONSTRAINT "map_clusters_version_cluster_pk" PRIMARY KEY("version","cluster")
);
--> statement-breakpoint
ALTER TABLE "artwork_embeddings" ADD CONSTRAINT "artwork_embeddings_artwork_id_artworks_id_fk" FOREIGN KEY ("artwork_id") REFERENCES "public"."artworks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artwork_map" ADD CONSTRAINT "artwork_map_artwork_id_artworks_id_fk" FOREIGN KEY ("artwork_id") REFERENCES "public"."artworks"("id") ON DELETE cascade ON UPDATE no action;