import { Hono } from "hono";
import type { HonoEnv } from "../types";
import { requireAuth } from "../auth/middleware";
import { badRequest, forbidden, tooMany } from "../lib/errors";
import { hasInstall } from "../db";
import { classifyReview, validateReviewText } from "./moderation";
import { checkRateLimit } from "../lib/rate-limit";

export const ratingRoutes = new Hono<HonoEnv>();

// Submit or update a rating. Gated on the caller having previously installed
// the plugin (seen in the installs table) so ratings correspond to real use.
// Review text is validated, and flagged reviews are stored with hidden=1.
ratingRoutes.post("/ratings", requireAuth, async (c) => {
  // Rate limit: cap casual abuse (bots/mass-review scripts) before we do any
  // expensive work like moderation classification.
  const userId = c.get("userId");
  if (!(await checkRateLimit(`ratings:${userId}`, 30, 3600))) {
    throw tooMany("too many ratings per hour");
  }
  const body = await c.req.json<{ plugin_id?: string; stars?: number; review_text?: string | null }>();
  const pluginId = body.plugin_id?.trim();
  if (!pluginId || pluginId.length > 128) throw badRequest("invalid plugin_id");
  const stars = body.stars;
  if (typeof stars !== "number" || !Number.isInteger(stars) || stars < 1 || stars > 5) {
    throw badRequest("stars must be an integer 1-5");
  }

  let text: string | null;
  try {
    text = validateReviewText(body.review_text);
  } catch (e) {
    throw badRequest((e as Error).message);
  }

  const installed = await hasInstall(c.env.DB, userId, pluginId);
  if (!installed) throw forbidden("must install plugin before rating");

  let hidden = 0;
  if (text) {
    const verdict = await classifyReview(c.env.AI, text);
    if (!verdict.safe) hidden = 1;
  }

  const now = Math.floor(Date.now() / 1000);
  await c.env.DB
    .prepare(
      `INSERT INTO ratings (user_id, plugin_id, stars, review_text, created_at, updated_at, hidden)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, plugin_id) DO UPDATE SET
         stars = excluded.stars,
         review_text = excluded.review_text,
         updated_at = excluded.updated_at,
         hidden = excluded.hidden`
    )
    .bind(userId, pluginId, stars, text, now, now, hidden)
    .run();

  return c.json({ ok: true, hidden: hidden === 1 });
});

// Delete the caller's own rating for a plugin. Scoped by user_id so one user
// cannot remove another's review.
ratingRoutes.delete("/ratings/:plugin_id", requireAuth, async (c) => {
  const pluginId = c.req.param("plugin_id");
  const userId = c.get("userId");
  await c.env.DB
    .prepare("DELETE FROM ratings WHERE user_id = ? AND plugin_id = ?")
    .bind(userId, pluginId)
    .run();
  return c.json({ ok: true });
});
