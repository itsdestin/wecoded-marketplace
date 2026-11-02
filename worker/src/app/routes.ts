import { Hono } from "hono";
import type { HonoEnv } from "../types";
import { badRequest, tooMany } from "../lib/errors";
import { checkRateLimit } from "../lib/rate-limit";
import { writeAppEvent } from "../lib/analytics";

export const appRoutes = new Hono<HonoEnv>();

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX_64 = /^[a-f0-9]{64}$/i;
const PLATFORMS = new Set(["desktop", "android"]);
const MAX_VERSION_LEN = 32;
const MAX_OS_LEN = 16;

interface AppEventBody {
  installId?: unknown;        // LEGACY — accepted but no AE write
  deviceIdHash?: unknown;     // NEW — required for AE write
  appVersion?: unknown;
  platform?: unknown;
  os?: unknown;
  team?: unknown;             // optional: true marks a team device (analytics deck D-2)
  milestone?: unknown;        // /app/milestone only
}

interface ParsedBody {
  deviceIdHash: string | null;   // null for legacy installId-only payloads
  appVersion: string;
  platform: "desktop" | "android";
  os: string;
  team: boolean;
}

// Validates the payload. Accepts either legacy `installId` (UUID) or new
// `deviceIdHash` (hex64). The discriminator: deviceIdHash is preferred when
// both are present. Legacy installId-only payloads return ParsedBody with
// deviceIdHash=null, signaling "do not write to AE."
function parseBody(body: AppEventBody): ParsedBody {
  const installId = typeof body.installId === "string" ? body.installId : "";
  const deviceIdHash = typeof body.deviceIdHash === "string" ? body.deviceIdHash : "";
  const appVersion = typeof body.appVersion === "string" ? body.appVersion : "";
  const platform = typeof body.platform === "string" ? body.platform : "";
  const os = typeof body.os === "string" ? body.os : "";

  const validInstallId = installId !== "" && UUID_V4.test(installId);
  const validDeviceHash = deviceIdHash !== "" && HEX_64.test(deviceIdHash);

  // Reject if both are present but malformed, OR neither is present, OR an
  // installId is present but malformed (catches typos in current clients).
  if (!validInstallId && !validDeviceHash) throw badRequest("invalid request");
  if (deviceIdHash !== "" && !validDeviceHash) throw badRequest("invalid request");
  if (installId !== "" && !validInstallId) throw badRequest("invalid request");

  if (!appVersion || appVersion.length > MAX_VERSION_LEN) throw badRequest("invalid request");
  if (!PLATFORMS.has(platform)) throw badRequest("invalid request");
  if (os.length > MAX_OS_LEN) throw badRequest("invalid request");
  if (body.team !== undefined && typeof body.team !== "boolean") throw badRequest("invalid request");

  return {
    deviceIdHash: validDeviceHash ? deviceIdHash : null,
    appVersion,
    platform: platform as "desktop" | "android",
    os,
    team: body.team === true,
  };
}

function clientIp(c: any): string {
  return c.req.header("CF-Connecting-IP") || c.req.header("X-Forwarded-For") || "unknown";
}

// WHY the platform rate-limit binding first (analytics deck T-1, 2026-10-31):
// checkRateLimit's Cache API counter was measured to limit nothing, so one
// script could invent thousands of devices. The binding is per address, per
// minute; absent in tests (and if ever unbound) it falls back to the old check.
export async function allowAppEvent(c: any, kind: string): Promise<boolean> {
  const ip = clientIp(c);
  const limiter = c.env.EVENT_RATE_LIMITER as RateLimit | undefined;
  if (limiter) {
    try { return (await limiter.limit({ key: `app:${ip}` })).success; } catch { /* fall through */ }
  }
  return checkRateLimit(`app-${kind}:${ip}`, 30, 3600);
}

async function handleHeartbeat(c: any) {
  if (!(await allowAppEvent(c, "heartbeat"))) {
    throw tooMany("too many requests");
  }
  const body = (await c.req.json().catch(() => ({}))) as AppEventBody;
  const parsed = parseBody(body);

  // Legacy installId-only payload: 200 OK, no AE write. Lets old clients
  // advance their lastPingedDate and stop retrying that day.
  if (parsed.deviceIdHash === null) {
    return c.json({ ok: true });
  }

  const country = c.req.header("CF-IPCountry") || "";
  const region = c.req.header("CF-IPRegionCode") || "";
  writeAppEvent(c.env, {
    deviceIdHash: parsed.deviceIdHash,
    appVersion: parsed.appVersion,
    platform: parsed.platform,
    os: parsed.os,
    country,
    region,
    team: parsed.team,
  });
  return c.json({ ok: true });
}

// One-time setup steps a fresh install passes (analytics deck U-2). Closed
// names only: the app never sends free text, and neither may anyone else.
const MILESTONE_RE = /^(first_open|setup_done|first_message|setup_failed_[a-z]{1,24})$/;

async function handleMilestone(c: any) {
  if (!(await allowAppEvent(c, "milestone"))) throw tooMany("too many requests");
  const body = (await c.req.json().catch(() => ({}))) as AppEventBody;
  const parsed = parseBody(body);
  const milestone = typeof body.milestone === "string" ? body.milestone : "";
  if (parsed.deviceIdHash === null || !MILESTONE_RE.test(milestone)) throw badRequest("invalid request");
  writeAppEvent(c.env, {
    kind: "milestone",
    deviceIdHash: parsed.deviceIdHash,
    appVersion: parsed.appVersion,
    platform: parsed.platform,
    os: parsed.os,
    country: c.req.header("CF-IPCountry") || "",
    region: c.req.header("CF-IPRegionCode") || "",
    team: parsed.team,
    detail: milestone,
  });
  return c.json({ ok: true });
}

// The single notice an app sends when its owner turns analytics off (deck
// U-6). It carries NO device hash — the person just asked not to be identified.
async function handleOptOut(c: any) {
  if (!(await allowAppEvent(c, "opt-out"))) throw tooMany("too many requests");
  const body = (await c.req.json().catch(() => ({}))) as AppEventBody;
  const appVersion = typeof body.appVersion === "string" ? body.appVersion : "";
  const platform = typeof body.platform === "string" ? body.platform : "";
  const os = typeof body.os === "string" ? body.os : "";
  if (!appVersion || appVersion.length > MAX_VERSION_LEN || !PLATFORMS.has(platform) || os.length > MAX_OS_LEN) throw badRequest("invalid request");
  if (body.deviceIdHash !== undefined || (body.team !== undefined && typeof body.team !== "boolean")) throw badRequest("invalid request");
  writeAppEvent(c.env, {
    kind: "opt_out",
    deviceIdHash: "",
    appVersion,
    platform: platform as "desktop" | "android",
    os,
    country: "",
    region: "",
    team: body.team === true,
  });
  return c.json({ ok: true });
}

// POST /app/heartbeat — fired at most once/day per device.
appRoutes.post("/app/heartbeat", handleHeartbeat);
appRoutes.post("/app/milestone", handleMilestone);
appRoutes.post("/app/opt-out", handleOptOut);

// POST /app/install — DEPRECATED. Returns 410 Gone. Legacy clients still
// post here once per launch (they fire-and-forget; the install event was
// the once-per-install marker, no state advance on 410). The handler is
// intentionally NOT rate-limited — a constant 410 response is cheaper to
// emit than the Cache API call rate-limiting would require.
appRoutes.post("/app/install", (c) => c.json({ deprecated: true }, 410));
