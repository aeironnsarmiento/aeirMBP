CREATE TABLE "music_job_state" (
	"job" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'idle' NOT NULL,
	"cursor" jsonb,
	"last_run_at" timestamp with time zone,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "music_scrobble" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"track_key" text NOT NULL,
	"artist_key" text NOT NULL,
	"album_key" text,
	"artist_name" text NOT NULL,
	"track_name" text NOT NULL,
	"album_name" text,
	"played_at" timestamp with time zone NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "music_track" (
	"track_key" text PRIMARY KEY NOT NULL,
	"artist_key" text NOT NULL,
	"artist_name" text NOT NULL,
	"track_name" text NOT NULL,
	"album_name" text,
	"duration_ms" integer,
	"artwork_url" text,
	"source" text,
	"enriched_at" timestamp with time zone,
	"attempted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "music_scrobble_identity_uq" ON "music_scrobble" USING btree ("track_key","played_at");--> statement-breakpoint
CREATE INDEX "music_scrobble_played_at_idx" ON "music_scrobble" USING btree ("played_at");--> statement-breakpoint
CREATE INDEX "music_scrobble_artist_played_idx" ON "music_scrobble" USING btree ("artist_key","played_at");--> statement-breakpoint
CREATE INDEX "music_scrobble_album_played_idx" ON "music_scrobble" USING btree ("album_key","played_at");--> statement-breakpoint
CREATE INDEX "music_track_attempted_idx" ON "music_track" USING btree ("attempted_at");