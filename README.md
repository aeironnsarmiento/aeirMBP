# xenComp

My personal site, shaped like a liquid-glass desktop.

Instead of pages, the site has widgets that sit on a dashboard as compact
glass cards and expand in place when you open one.
Each widget is its own individual project:

- About me / Projects
- Music Tracker
  WIP
- Chatbot (about myself)

## Stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript**
- **Postgres** on Supabase, queried with **Drizzle ORM**
- **Supabase Storage** for uploaded images
- Plain **CSS** with custom properties — no Tailwind
- **View Transitions API** for the expand/collapse motion
- **Vitest** for tests, **PGlite** for the SQL ones
- Deployed on **Vercel**

## Running it

```bash
npm install
cp docs/.env.example .env.local   # fill in the values
npm run db:migrate
npm run dev
```
