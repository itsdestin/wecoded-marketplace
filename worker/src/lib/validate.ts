import { badRequest } from "./errors";
import { themeSlugAllowed } from "./theme-registry";
import type { Env } from "../types";

// Normalizes and validates a plugin/theme id from request input. Trims
// surrounding whitespace, rejects empty or over-128-char values with a 400,
// and returns the cleaned id. Centralizes the `!id || id.length > 128` check
// that every id-taking route (ratings, installs, themes) previously copied.
// `label` names the field in the error message ("plugin_id", "theme id").
// Trimming param sources (not just JSON bodies) is intentional normalization —
// an id with stray whitespace would never match a stored row anyway.
export function validateId(raw: string | undefined | null, label = "plugin_id"): string {
  const id = raw?.trim();
  if (!id || id.length > 128) throw badRequest(`invalid ${label}`);
  return id;
}

// An id that names something we actually list. `validateId` only bounds the
// length, which let a signed-in account write installs/votes/comments against
// invented ids — junk rows with no ceiling. catalog_items is the list of real
// ones, so this is only possible once the catalog exists (migration 0006).
//
// Two deliberate escapes: theme ids live in the themes registry, not the
// catalog; and an EMPTY catalog (fresh DB, ingest never ran) passes everything,
// because an unpopulated catalog must never lock a user out of installing.
export async function requireCatalogId(
  db: D1Database,
  raw: string | undefined | null,
  label = "plugin_id",
  // WHY optional: when given, a "theme:<name>" id must also name a real theme. Callers
  // that cannot pass it keep the old behaviour (format check only).
  env?: Pick<Env, "CATALOG_KV" | "THEME_REGISTRY_URL">
): Promise<string> {
  const id = validateId(raw, label);
  if (id.startsWith("theme:")) {
    // WHY: this prefix used to skip every check, so anyone could invent unlimited
    // "theme:whatever" ids and fill the tables. Now the name must look like a theme
    // name and (when the registry is reachable) be one.
    if (env && !(await themeSlugAllowed(env, id.slice("theme:".length)))) throw badRequest(`unknown ${label}`);
    return id;
  }
  const hit = await db.prepare("SELECT 1 AS ok FROM catalog_items WHERE id = ? LIMIT 1").bind(id).first<{ ok: number }>();
  if (hit) return id;
  const any = await db.prepare("SELECT 1 AS ok FROM catalog_items LIMIT 1").first<{ ok: number }>();
  if (!any) return id;                       // catalog not populated yet — allow
  throw badRequest(`unknown ${label}`);
}

/** D1 allows at most 100 bound parameters per statement. */
const IN_CHUNK = 100;

// The same check for the sign-in RECONCILE batch, which is a different problem:
// it reports everything the client currently holds, and some of that legitimately
// is not a marketplace listing (a plugin the user built themselves, or one
// installed from a path). Failing the whole call there would leave a user with
// NO installs recorded and every vote refused as "must install plugin before
// voting" — so unknown ids are dropped from the write instead, and the caller
// reports how many were dropped rather than dropping them silently. Malformed
// ids still reject the whole call, via validateId in the caller.
export async function filterCatalogIds(
  db: D1Database,
  ids: string[],
  env?: Pick<Env, "CATALOG_KV" | "THEME_REGISTRY_URL">
): Promise<string[]> {
  if (ids.length === 0) return ids;
  const any = await db.prepare("SELECT 1 AS ok FROM catalog_items LIMIT 1").first<{ ok: number }>();
  if (!any) return ids;                      // catalog not populated yet — allow everything
  // Theme ids are checked against the theme registry (fail-open) instead of waved through.
  const themeOk = new Map<string, boolean>();
  if (env) {
    for (const id of ids) {
      if (id.startsWith("theme:")) themeOk.set(id, await themeSlugAllowed(env, id.slice("theme:".length)));
    }
  }
  const known = new Set<string>();
  const lookup = ids.filter((id) => !id.startsWith("theme:"));
  for (let i = 0; i < lookup.length; i += IN_CHUNK) {
    const part = lookup.slice(i, i + IN_CHUNK);
    const { results } = await db
      .prepare(`SELECT id FROM catalog_items WHERE id IN (${part.map(() => "?").join(",")})`)
      .bind(...part).all<{ id: string }>();
    for (const r of results) known.add(r.id);
  }
  return ids.filter((id) => (id.startsWith("theme:") ? themeOk.get(id) ?? true : known.has(id)));
}
