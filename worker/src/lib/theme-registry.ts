// Which theme names are real. Theme listings live in the community theme registry
// (a separate repo), not in this database, so the worker used to accept ANY name that
// started with "theme:" or any id on the like route. This looks the real names up,
// caches them in KV for an hour, and fails OPEN: if the registry cannot be reached the
// caller falls back to format checks only, so a registry outage never blocks users.

import type { Env } from "../types";

const KV_KEY = "theme-registry:slugs";
const TTL_SEC = 3600;
/** What a theme slug looks like (lowercase words joined by dashes). */
export const THEME_SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;

export async function knownThemeSlugs(env: Pick<Env, "CATALOG_KV" | "THEME_REGISTRY_URL">): Promise<Set<string> | null> {
  try {
    const cached = await env.CATALOG_KV?.get<{ at: number; slugs: string[] }>(KV_KEY, "json");
    if (cached && Array.isArray(cached.slugs) && Date.now() - cached.at < TTL_SEC * 1000) return new Set(cached.slugs);
  } catch { /* fall through to fetch */ }
  const url = env.THEME_REGISTRY_URL;
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    const json = (await res.json()) as { themes?: Array<{ slug?: unknown }> };
    const slugs = (json.themes ?? []).map((t) => t.slug).filter((s): s is string => typeof s === "string");
    // An empty list means "something is wrong with the registry", not "no themes exist".
    if (slugs.length === 0) return null;
    try { await env.CATALOG_KV?.put(KV_KEY, JSON.stringify({ at: Date.now(), slugs }), { expirationTtl: TTL_SEC * 2 }); } catch { /* best effort */ }
    return new Set(slugs);
  } catch {
    return null;
  }
}

/** Throws nothing; returns false only when the registry is reachable and the slug is not in it. */
export async function themeSlugAllowed(env: Pick<Env, "CATALOG_KV" | "THEME_REGISTRY_URL">, slug: string): Promise<boolean> {
  if (!THEME_SLUG.test(slug)) return false;
  const known = await knownThemeSlugs(env);
  return known ? known.has(slug) : true;
}
