// Privacy-by-construction wrapper around env.APP_ANALYTICS.writeDataPoint.
// Enforces the blob order that all /admin/analytics/* SQL queries assume.
// No caller outside this file should ever touch env.APP_ANALYTICS directly.
import type { Env } from "../types";

export type AppEventType = "install" | "heartbeat";

export interface AppEventPayload {
  eventType: AppEventType;
  installId: string;
  appVersion: string;
  platform: "desktop" | "android";
  os: string;      // "win" | "mac" | "linux" for desktop; "" on android
  country: string; // ISO 2-letter from CF-IPCountry, or ""
}

// The optional chaining is load-bearing: tests run with APP_ANALYTICS undefined
// because vitest-pool-workers can't resolve the binding. Production always has it.
export function writeAppEvent(env: Env, payload: AppEventPayload): void {
  env.APP_ANALYTICS?.writeDataPoint({
    blobs: [
      payload.eventType,   // blob1 — also in indexes for fast WHERE filters
      payload.installId,   // blob2 — COUNT_DISTINCT only, never returned to clients
      payload.appVersion,  // blob3
      payload.platform,    // blob4
      payload.os,          // blob5
      payload.country,     // blob6
    ],
    doubles: [],
    indexes: [payload.eventType],
  });
}
