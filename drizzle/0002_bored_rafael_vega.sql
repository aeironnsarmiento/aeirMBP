CREATE TABLE "music_artist" (
	"artist_key" text PRIMARY KEY NOT NULL,
	"artist_name" text NOT NULL,
	"picture_url" text,
	"source" text,
	"enriched_at" timestamp with time zone,
	"attempted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "music_artist_attempted_idx" ON "music_artist" USING btree ("attempted_at");