import { Hono } from "hono";
import type { HonoEnv } from "../types";
import { requireAuth } from "../auth/middleware";
import { validateId } from "../lib/validate";
import { badRequest, tooMany } from "../lib/errors";
import { checkRateLimit } from "../lib/rate-limit";
import { themeSlugAllowed } from "../lib/theme-registry";

export const themeRoutes = new Hono<HonoEnv>();

// Most themes one account can have liked at once. WHY: every like is a permanent row
// that GET /stats later has to scan and send to everyone; no real person likes this many.
export const MAX_THEME_LIKES_PER_USER = 500;

themeRoutes.post("/themes/:id/like", requireAuth, async (c) => {
  const themeId = validateId(c.req.param("id"), "theme id");
  const userId = c.get("userId");
  // WHY: this route had no limit at all, so one account could add or flip likes in a loop.
  if (!(await checkRateLimit(`theme-like:${userId}`, 120, 3600))) throw tooMany("too many theme likes");
  const existing = await c.env.DB
    .prepare("SELECT 1 AS one FROM theme_likes WHERE user_id = ? AND theme_id = ?")
    .bind(userId, themeId)
    .first<{ one: number }>();
  if (existing) {
    // Un-liking is always allowed, even for a theme that has since left the registry.
    await c.env.DB
      .prepare("DELETE FROM theme_likes WHERE user_id = ? AND theme_id = ?")
      .bind(userId, themeId)
      .run();
    return c.json({ liked: false });
  }
  // WHY: previously any string was accepted, so likes could be recorded for themes that
  // do not exist (junk rows that then bloat the public stats answer forever).
  if (!(await themeSlugAllowed(c.env, themeId))) throw badRequest("unknown theme id");
  const count = await c.env.DB
    .prepare("SELECT COUNT(*) AS n FROM theme_likes WHERE user_id = ?")
    .bind(userId)
    .first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_THEME_LIKES_PER_USER) throw tooMany("too many liked themes");
  await c.env.DB
    .prepare("INSERT INTO theme_likes (user_id, theme_id, liked_at) VALUES (?, ?, ?)")
    .bind(userId, themeId, Math.floor(Date.now() / 1000))
    .run();
  return c.json({ liked: true });
});
