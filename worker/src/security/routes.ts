// GET /security/blocked-plugins — the plugin off-switch list (see blocked-plugins.ts).
//
// WHY its own path and not /catalog/blocked: /catalog/:id already serves one listing by id, so a
// plugin that happened to be named "blocked" would collide. WHY no database read: the list is
// compiled in, so this answer costs nothing and keeps working when the catalog is switched off
// (CATALOG_ENABLED) or D1 is having a bad day — exactly when the off-switch may be needed.
// Five-minute cache: the app asks hourly, so a newly listed plugin is off everywhere within ~1h5m.
import { Hono } from "hono";
import type { HonoEnv } from "../types";
import { BLOCKED_PLUGINS } from "./blocked-plugins";

export const securityRoutes = new Hono<HonoEnv>();

securityRoutes.get("/security/blocked-plugins", (c) => {
  c.header("Cache-Control", "public, max-age=300");
  return c.json({ blocked: BLOCKED_PLUGINS });
});
