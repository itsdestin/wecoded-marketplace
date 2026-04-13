import { Hono } from "hono";
import type { HonoEnv } from "../types";
import { requireAuth } from "../auth/middleware";
import { badRequest, forbidden, notFound } from "../lib/errors";
import { randomToken } from "../lib/crypto";

export const reportRoutes = new Hono<HonoEnv>();

// Admin check: env var is a comma-separated user id list, populated via secret
// in prod and via test/setup.ts or [env.test.vars] in tests.
function isAdmin(env: { ADMIN_USER_IDS: string }, userId: string): boolean {
  const admins = env.ADMIN_USER_IDS.split(",").map((s) => s.trim()).filter(Boolean);
  return admins.includes(userId);
}

// POST /reports — any authed user flags a rating for moderation review
reportRoutes.post("/reports", requireAuth, async (c) => {
  const body = await c.req.json<{ rating_user_id?: string; rating_plugin_id?: string; reason?: string }>();
  if (!body.rating_user_id || !body.rating_plugin_id) throw badRequest("missing fields");
  if (body.reason && body.reason.length > 500) throw badRequest("reason too long");
  const reporter = c.get("userId");
  const id = randomToken(16);
  await c.env.DB
    .prepare(
      `INSERT INTO reports (id, rating_user_id, rating_plugin_id, reporter_user_id, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(id, body.rating_user_id, body.rating_plugin_id, reporter, body.reason ?? null, Math.floor(Date.now() / 1000))
    .run();
  return c.json({ ok: true, id });
});

// DELETE /admin/ratings/:user_id/:plugin_id — admin hides a rating and resolves
// any open reports against it in a single step
reportRoutes.delete("/admin/ratings/:user_id/:plugin_id", requireAuth, async (c) => {
  if (!isAdmin(c.env, c.get("userId"))) throw forbidden("admin only");
  // user_id contains a colon (github:123) so it's URL-encoded in the path
  const userId = decodeURIComponent(c.req.param("user_id"));
  const pluginId = c.req.param("plugin_id");
  const res = await c.env.DB
    .prepare("UPDATE ratings SET hidden = 1 WHERE user_id = ? AND plugin_id = ?")
    .bind(userId, pluginId)
    .run();
  if (res.meta.changes === 0) throw notFound("rating not found");
  await c.env.DB
    .prepare(
      `UPDATE reports SET resolved_at = ?, resolution = 'hidden'
       WHERE rating_user_id = ? AND rating_plugin_id = ? AND resolved_at IS NULL`
    )
    .bind(Math.floor(Date.now() / 1000), userId, pluginId)
    .run();
  return c.json({ ok: true });
});

// GET /admin/reports — admin queue of unresolved reports with rating context
reportRoutes.get("/admin/reports", requireAuth, async (c) => {
  if (!isAdmin(c.env, c.get("userId"))) throw forbidden("admin only");
  const { results } = await c.env.DB
    .prepare(
      `SELECT r.*, rt.stars, rt.review_text
       FROM reports r
       LEFT JOIN ratings rt ON rt.user_id = r.rating_user_id AND rt.plugin_id = r.rating_plugin_id
       WHERE r.resolved_at IS NULL
       ORDER BY r.created_at ASC`
    )
    .all();
  return c.json({ reports: results });
});
