// Privacy-by-construction wrapper around env.APP_ANALYTICS.writeDataPoint.
// Enforces the blob order that all /admin/analytics/* SQL queries assume.
// No caller outside this file should ever touch env.APP_ANALYTICS directly.
import type { Env } from "../types";

// blob1. "heartbeat" is the once-a-day check-in every query counts; the two
// one-time kinds (analytics deck U-2/U-6, 2026-10-31) share the dataset so they
// get the same team/dev-device filters, and every existing query already reads
// only blob1 = 'heartbeat', so they can never inflate active-device counts.
export type AppEventKind = "heartbeat" | "milestone" | "opt_out";

export interface AppEventPayload {
  kind?: AppEventKind;        // default "heartbeat"
  deviceIdHash: string;       // 64-char hex (HMAC-SHA256 client-side); "" for opt_out
  appVersion: string;
  platform: "desktop" | "android";
  os: string;                 // "win" | "mac" | "linux" for desktop; "" on android
  country: string;            // ISO 2-letter from CF-IPCountry, or ""
  region: string;             // ISO 3166-2 from CF-IPRegionCode, or ""
  team?: boolean;             // the device carries the app's "team device" mark
  detail?: string;            // milestone name; "" otherwise
}

// The optional chaining is load-bearing: tests run with APP_ANALYTICS undefined
// because vitest-pool-workers can't resolve the binding. Production always has it.
export function writeAppEvent(env: Env, payload: AppEventPayload): void {
  const kind = payload.kind ?? "heartbeat";
  env.APP_ANALYTICS?.writeDataPoint({
    blobs: [
      kind,                   // blob1 — event kind
      payload.deviceIdHash,   // blob2 — semantically replaces install_id
      payload.appVersion,     // blob3
      payload.platform,       // blob4
      payload.os,             // blob5
      payload.country,        // blob6
      payload.region,         // blob7
      payload.team ? "team" : "", // blob8 — team device (dashboard leaves it out)
      payload.detail ?? "",   // blob9 — milestone name
    ],
    doubles: [],
    indexes: [kind],
  });
}
