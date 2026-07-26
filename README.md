# xenComp

A personal site shaped like a liquid-glass desktop. About, Music and Projects
are widgets: compact cards on a dashboard, expanding into glass modals. The
music widget owns its listening data — the full last.fm scrobble history is
imported into Postgres, enriched with durations and artwork from open sources,
and every aggregate view is served from that store rather than from last.fm.

Built from [`docs/plans/2026-07-25-001-feat-liquid-glass-personal-site-plan.md`](docs/plans/2026-07-25-001-feat-liquid-glass-personal-site-plan.md).

## Stack

Next.js App Router on Vercel · Drizzle + Supabase Postgres · Supabase Storage ·
Vitest (+ PGlite for real SQL tests) · plain CSS with custom properties.

## Layout

```text
app/              routes; api/* are thin mounts over widget handlers
components/
  glass/          GlassSurface, GlassModal, theme tokens, blur budget
  shell/          TopBar, Sidebar, WidgetGrid, ModalHost, open-widget store
lib/
  auth/           owner session cookie and guards
  db/             Drizzle client and schema
  registry/       manifest contract and registry assembly
  site/           site_setting query layer, avatar storage
  theme/          committed background set
widgets/
  about/  music/  projects/  settings/
```

Each widget owns its manifest, compact view, expanded view, server handlers and
query layer. The shell owns glass, layout, theming, auth and mounting. Adding a
fifth widget is one directory plus one line in `lib/registry/index.ts`.

## Setup

```bash
npm install
cp .env.example .env.local   # then fill it in — see below
npm run db:migrate
npm run dev
```

### Environment

| Variable | What it is |
|---|---|
| `DATABASE_URL` | Supabase Postgres connection string. Must be a `postgresql://` URL with the user and password inline — a `jdbc:` URL will not connect. |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side key for avatar uploads. |
| `SUPABASE_STORAGE_BUCKET` | Public bucket for the avatar. Defaults to `site-assets`. |
| `OWNER_SECRET` | The single owner credential. Also signs the session cookie, so rotating it signs you out everywhere. 32+ random characters. |
| `LASTFM_API_KEY` | From <https://www.last.fm/api/account/create>. |
| `LASTFM_USER` | The last.fm handle to import. |
| `CRON_SECRET` | Guards `/api/cron/poll`. Vercel sends it as `Authorization: Bearer …`. |

Create the storage bucket in the Supabase dashboard and mark it public before
uploading an avatar.

## First run

1. Sign in: the padlock in the top bar, then the owner secret.
2. Open **Settings** (`s`) → **Run backfill**. It imports a bounded batch of
   pages per click and reports progress; keep clicking until it says complete.
   Roughly 37 pages at 200 scrobbles each.
3. **Run enrichment** the same way. It resolves duration and artwork per unique
   track from Deezer, falling back to MusicBrainz and Cover Art Archive. Slower
   than backfill — MusicBrainz enforces one request per second.

Both jobs are resumable and idempotent: interrupting one loses nothing, and
re-running a finished one issues no requests and inserts no rows.

## Scheduled work

`vercel.json` runs `/api/cron/poll` once a day. That frequency is the Vercel
Hobby ceiling and anything faster fails deployment. It is not only a freshness
knob — the run also writes a heartbeat, which resets Supabase's seven-day
pause-on-inactivity timer. Removing the cron eventually pauses the database.

## Verification

| Command | Checks |
|---|---|
| `npm run typecheck` | No type errors |
| `npm run lint` | Clean |
| `npm run test` | Unit and SQL tests |
| `npm run build` | Production build |
| `npm run db:migrate` | Migrations apply |

The aggregation tests run against real Postgres in-process via PGlite, so the
`GROUP BY` queries and window filters are exercised as written rather than
against a fake.
