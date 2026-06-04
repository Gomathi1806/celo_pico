/**
 * Resolves the public URL of this deployment. Tries, in order:
 *   1. NEXT_PUBLIC_APP_URL (must be a full http/https URL)
 *   2. VERCEL_PROJECT_PRODUCTION_URL — Vercel auto-injects this on every
 *      deployment as the stable prod alias (e.g. "pico-silk.vercel.app").
 *   3. VERCEL_URL — the deployment's specific URL (changes each deploy).
 *   4. http://localhost:3000 (local dev fallback).
 *
 * Robust against empty strings and stray whitespace. Critical because
 * `new URL("")` throws ERR_INVALID_URL at build time and breaks Next's
 * static page generation for `/_not-found` and similar routes.
 */
export function getAppUrl(): string {
  const explicit = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim();
  if (explicit && /^https?:\/\//.test(explicit)) return explicit;

  const prodAlias = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (prodAlias) return `https://${prodAlias}`;

  const vercelUrl = process.env.VERCEL_URL?.trim();
  if (vercelUrl) return `https://${vercelUrl}`;

  return "http://localhost:3000";
}
