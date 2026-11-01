// SQL fragment helpers for admin analytics queries. Every helper returns
// strings that are safe to interpolate into a SQL query because it strictly
// sanitizes the values it pulls from env vars or request query params.
//
// Why strings, not parameterized queries: Cloudflare's AE SQL endpoint
// takes raw text/plain SQL; there's no parameter binding API.
//
// Contract for the query-param helpers: invalid input never errors and never
// reaches the SQL as raw text — the clause is simply omitted (or, for the
// timestamp expression, falls back to plain `timestamp`).
import type { Env } from "../types";

// Returns "AND blob2 NOT IN ('hash1','hash2',...)" or "" if filter disabled.
// Each comma-separated token is scanned for exactly one run of 64 consecutive
// hex characters — the first such run is the hash. Any surrounding injection
// characters (apostrophes, semicolons, SQL keywords) are non-hex and thus
// not captured. Tokens with no 64-hex run are dropped.
// The hand-kept list of the owner's device hashes, as quoted SQL literals.
function knownDevHashes(env: Env): string[] {
  const raw = env.KNOWN_DEV_DEVICES ?? "";
  if (!raw) return [];
  // Match the first run of exactly 64 hex chars from each comma-separated token.
  // The negative lookahead/lookbehind prevent matching a substring of a longer
  // hex run (e.g. 128-char token should not produce a truncated hash).
  const EXACT_64_HEX = /(?<![a-f0-9])([a-f0-9]{64})(?![a-f0-9])/i;
  const hashes = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((token) => {
      const captured = token.match(EXACT_64_HEX)?.[1];
      return captured ? captured.toLowerCase() : null;
    })
    .filter((h): h is string => h !== null)
    .map((h) => `'${h}'`);
  return hashes;
}

// Leaves out the owner's and contributors' devices: anything the app marked as a
// team device (blob8, analytics deck D-2, 2026-10-31) plus the hand-kept hash list.
// Returns "" only when the owner asked to include them ("My devices").
export function adminFilterClause(env: Env, includeAdmins: boolean): string {
  if (includeAdmins) return "";
  const hashes = knownDevHashes(env);
  const team = "AND blob8 != 'team'";
  return hashes.length ? `${team} AND blob2 NOT IN (${hashes.join(",")})` : team;
}

// "blob2 IN (…)" for the hand-kept list, or "" when it is empty — used only to
// COUNT how many devices the list left out (deck D-5), never to return them.
export function knownDevInClause(env: Env): string {
  const hashes = knownDevHashes(env);
  return hashes.length ? `AND blob2 IN (${hashes.join(",")})` : "";
}

// Historical packaged smoke tests reported ordinary beta versions before the
// client learned to suppress analytics. Keep this user-approved list exact:
// broad prerelease patterns would erase other real beta users too.
const HISTORICAL_CI_VERSIONS = [
  "1.2.4-releasetest",
  "1.3.0-beta",
  "1.3.0-beta.71",
  "1.3.0-beta.73",
  "1.3.0-beta.74",
  "1.3.0-beta.77",
  "1.3.0-beta.78",
  "1.3.0-beta.79",
  "1.3.0-beta.81",
  "1.3.0-beta.84",
  "1.3.0-beta.85",
  "1.3.0-beta.86",
] as const;

export function historicalCiVersionClause(): string {
  return `AND blob3 NOT IN (${HISTORICAL_CI_VERSIONS.map((version) => `'${version}'`).join(",")})`;
}

// Returns "AND timestamp > toDateTime('<iso>')" or "" if cutover disabled.
// Extracts the first ISO-8601 date/datetime from the raw value — injection
// characters surrounding or appended to a valid date are non-ISO and thus
// not captured by the extraction regex.
export function cutoverClause(env: Env): string {
  const raw = env.CUTOVER_TIMESTAMP ?? "";
  if (!raw) return "";
  // Extract the first ISO-8601 date or datetime from the raw string.
  // Accepted forms: YYYY-MM-DD, YYYY-MM-DDTHH:MM:SSZ, etc.
  // Apostrophes, semicolons, SQL keywords, and "--" are not in the charset
  // [0-9T:\-Z.] so they break the match boundary automatically.
  const match = raw.match(
    /(\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)?)/
  );
  if (!match) return "";
  return `AND timestamp > toDateTime('${match[1]}')`;
}

// Returns the SQL expression for an event's LOCAL wall-clock time, so day and
// week buckets line up with the admin's calendar instead of UTC midnight.
// `tz_offset` is integer minutes where local = UTC + offset (e.g. 60 for CET,
// -300 for EST — the opposite sign of JS getTimezoneOffset()).
// WHY the strict shape: the count is interpolated into an INTERVAL literal, so
// only a bare 1-4 digit integer within ±840 (±14h, the real-world extremes)
// is accepted; the emitted digits come from the parsed number, not the input.
// 0 and anything invalid fall back to plain `timestamp` (identical to UTC SQL).
// AE requires the quoted count: INTERVAL '60' MINUTE.
export function localTimestampExpr(rawOffset: string | undefined): string {
  const raw = rawOffset ?? "";
  if (!/^-?\d{1,4}$/.test(raw)) return "timestamp";
  const minutes = Number(raw);
  if (!Number.isInteger(minutes) || minutes === 0 || minutes < -840 || minutes > 840) {
    return "timestamp";
  }
  return minutes > 0
    ? `(timestamp + INTERVAL '${minutes}' MINUTE)`
    : `(timestamp - INTERVAL '${Math.abs(minutes)}' MINUTE)`;
}

// WHY these expressions (analytics audit, 2026-10-31): Android 1.3.1–1.3.3
// checked in with platform "desktop", but a phone never fills the OS field and
// a computer always does — so an empty OS means a phone, for old rows and new.
export const PLATFORM_EXPR = "if(blob4 = 'android' OR blob5 = '', 'android', 'desktop')";
// Windows / Mac / Linux / Android, the same four the website's download buttons use.
export const OS_EXPR = "if(blob4 = 'android' OR blob5 = '', 'android', blob5)";

// Row filter for one platform: `desktop`, `android`, or one of the four
// systems `win`, `mac`, `linux` (Android counts as its own system). Anything
// else returns "". An allowlist (not a charset) because the set is closed.
export function platformClause(raw: string | undefined): string {
  if (raw === "android") return "AND (blob4 = 'android' OR blob5 = '')";
  if (raw === "desktop") return "AND blob4 = 'desktop' AND blob5 != ''";
  if (raw === "win" || raw === "mac" || raw === "linux") return `AND blob4 = 'desktop' AND blob5 = '${raw}'`;
  return "";
}

// Returns "AND blob3 = '<version>'" for a plausible version string, else "".
// The charset [0-9A-Za-z.+-] covers semver incl. prerelease/build suffixes
// (1.4.0-releasetest, 1.4.0+abc) and excludes quotes, spaces, semicolons and
// backslashes, so the value can't break out of the SQL string literal.
export function versionClause(raw: string | undefined): string {
  if (raw === undefined || !/^[0-9A-Za-z.+-]{1,64}$/.test(raw)) return "";
  return `AND blob3 = '${raw}'`;
}

// Returns a clause excluding test builds (side-by-side `-releasetest` APKs and
// `-dev` desktop builds) when `hide_test=1`, else "". Constant text — no input
// is interpolated.
export function hideTestClause(raw: string | undefined): string {
  if (raw !== "1") return "";
  return "AND blob3 NOT LIKE '%-releasetest' AND blob3 NOT LIKE '%-dev'";
}
