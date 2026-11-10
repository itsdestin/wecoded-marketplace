// Helpers for binding a sign-in to the app that started it (card #55).
//
// The weakness being closed: a sign-in link by itself says nothing about WHO asked
// for it. If an attacker starts a sign-in, sends the link to a victim, and the
// victim approves it at GitHub, the attacker (who holds the device_code) would get
// the victim's session. The fix is a second secret that only travels from the
// server to the approving browser to http://127.0.0.1:<port> on THAT computer. The
// attacker's own computer never receives it, so the attacker's poll cannot finish.

import type { D1Database } from "@cloudflare/workers-types";
import { randomToken, sha256Hex, constantTimeEqual } from "../lib/crypto";

/** Ports below 1024 are privileged; the app listens on an ordinary high port. */
export function isValidLoopbackPort(raw: unknown): raw is number {
  return typeof raw === "number" && Number.isInteger(raw) && raw >= 1024 && raw <= 65535;
}

/**
 * Keyed, day-salted fingerprint of a caller address, for the short-lived
 * "how many sign-ins has this network started" count. Not reversible without the
 * server secret, changes every day, and lives only as long as the device_codes row.
 * IPv6 callers are grouped by their /64 so one machine cannot dodge the cap by
 * rotating the low bits of its address.
 */
export async function ipBucket(secret: string, ip: string, nowSec: number): Promise<string> {
  const day = Math.floor(nowSec / 86400);
  let who = ip;
  if (ip.includes(":")) who = ip.split(":").slice(0, 4).join(":");
  return (await sha256Hex(`signin-bucket|${secret}|${day}|${who}`)).slice(0, 24);
}

/**
 * Called once GitHub has approved. Marks the row authorised and, when the app
 * registered a loopback port, mints the one-time secret and returns where to send
 * the browser. Returns null for older apps (no loopback), who finish by polling alone.
 */
export async function authorizeDeviceCode(
  db: D1Database,
  csrfState: string,
  userId: string
): Promise<{ port: number; secret: string } | null> {
  const row = await db
    .prepare("SELECT loopback_port FROM device_codes WHERE csrf_state = ?")
    .bind(csrfState)
    .first<{ loopback_port: number | null }>();
  const port = row?.loopback_port ?? null;
  let secret: string | null = null;
  let hash: string | null = null;
  if (port !== null) {
    secret = randomToken(32);
    hash = await sha256Hex(secret);
  }
  await db
    .prepare("UPDATE device_codes SET authorized_user_id = ?, loopback_hash = ? WHERE csrf_state = ?")
    .bind(userId, hash, csrfState)
    .run();
  return port !== null && secret ? { port, secret } : null;
}

/** True when this poll may collect the session. Rows without a loopback hash (older apps) need nothing extra. */
export async function loopbackSecretOk(storedHash: string | null, presented: unknown): Promise<boolean> {
  if (!storedHash) return true;
  if (typeof presented !== "string" || presented.length !== 64) return false;
  return constantTimeEqual(await sha256Hex(presented), storedHash);
}
