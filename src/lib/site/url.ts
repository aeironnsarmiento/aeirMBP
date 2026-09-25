/**
 * The absolute origin the site is served from. Vercel sets the production
 * domain on every deployment, previews included, so crawlers are always
 * pointed at the canonical site rather than a throwaway preview URL.
 */
export function siteUrl(): string {
  const production = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return production ? `https://${production}` : "http://localhost:3000";
}
