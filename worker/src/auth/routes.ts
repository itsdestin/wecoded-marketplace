// GitHub OAuth device-code flow routes.
//
// Flow:
//   1. POST /auth/github/start           — app creates device_code + user_code
//   2. GET  /auth/github/start-redirect  — browser hits this, 302s to GitHub authorize
//   3. GET  /auth/github/callback        — GitHub redirects here with code + state
//   4. POST /auth/github/poll            — app retrieves the raw bearer token once ready
//
// NOTE on session_token_hash reuse: the `device_codes.session_token_hash`
// column transiently holds the RAW bearer token between callback and poll. The
// device_code itself is the secret gating retrieval, and the row is deleted on
// first successful poll. The permanent `sessions` table only ever stores a
// SHA-256 hash. Column naming is historical; see plan Task 4 for rationale.

import { Hono } from "hono";
import type { HonoEnv } from "../types";
import { randomToken, randomUserCode } from "../lib/crypto";
import { badRequest, notFound } from "../lib/errors";
import { buildAuthorizeUrl, exchangeCode, fetchGitHubUser } from "./github";
import { issueSession } from "./sessions";
import { upsertUser } from "../db";

const DEVICE_CODE_TTL_SEC = 900; // 15 min

export const authRoutes = new Hono<HonoEnv>();

authRoutes.post("/auth/github/start", async (c) => {
  const deviceCode = randomToken(32);
  const userCode = randomUserCode();
  const now = Math.floor(Date.now() / 1000);
  await c.env.DB
    .prepare(
      `INSERT INTO device_codes (device_code, user_code, expires_at, created_at)
       VALUES (?, ?, ?, ?)`
    )
    .bind(deviceCode, userCode, now + DEVICE_CODE_TTL_SEC, now)
    .run();
  const origin = new URL(c.req.url).origin;
  const authUrl = `${origin}/auth/github/start-redirect?user_code=${encodeURIComponent(userCode)}`;
  return c.json({ device_code: deviceCode, user_code: userCode, auth_url: authUrl, expires_in: DEVICE_CODE_TTL_SEC });
});

authRoutes.get("/auth/github/start-redirect", (c) => {
  const userCode = c.req.query("user_code");
  if (!userCode) throw badRequest("missing user_code");
  const callback = `${new URL(c.req.url).origin}/auth/github/callback`;
  return c.redirect(buildAuthorizeUrl(c.env.GH_CLIENT_ID, userCode, callback));
});

authRoutes.get("/auth/github/callback", async (c) => {
  const code = c.req.query("code");
  const userCode = c.req.query("state");
  if (!code || !userCode) throw badRequest("missing code or state");

  const dcRow = await c.env.DB
    .prepare("SELECT device_code, expires_at, session_token_hash FROM device_codes WHERE user_code = ?")
    .bind(userCode)
    .first<{ device_code: string; expires_at: number; session_token_hash: string | null }>();
  if (!dcRow) throw notFound("unknown user_code");
  if (dcRow.expires_at < Math.floor(Date.now() / 1000)) throw badRequest("expired");
  // Idempotent: if already authorized, don't re-run the exchange.
  if (dcRow.session_token_hash) return c.html("<h1>Already authorized — you can close this window.</h1>");

  const accessToken = await exchangeCode(c.env.GH_CLIENT_ID, c.env.GH_CLIENT_SECRET, code);
  const gh = await fetchGitHubUser(accessToken);
  const userId = `github:${gh.id}`;
  await upsertUser(c.env.DB, { id: userId, github_login: gh.login, github_avatar_url: gh.avatar_url });
  const sessionToken = await issueSession(c.env.DB, userId);

  // Stash the RAW token in device_codes.session_token_hash for the poll endpoint
  // to retrieve. Deleted on first poll. See header comment.
  await c.env.DB
    .prepare("UPDATE device_codes SET session_token_hash = ? WHERE user_code = ?")
    .bind(sessionToken, userCode)
    .run();

  return c.html(
    `<h1>Signed in as ${gh.login}</h1><p>You can close this window and return to DestinCode.</p>`
  );
});

authRoutes.post("/auth/github/poll", async (c) => {
  const body = await c.req.json<{ device_code?: string }>();
  if (!body.device_code) throw badRequest("missing device_code");
  const row = await c.env.DB
    .prepare("SELECT user_code, session_token_hash, expires_at FROM device_codes WHERE device_code = ?")
    .bind(body.device_code)
    .first<{ user_code: string; session_token_hash: string | null; expires_at: number }>();
  if (!row) throw notFound("unknown device_code");
  if (row.expires_at < Math.floor(Date.now() / 1000)) {
    await c.env.DB.prepare("DELETE FROM device_codes WHERE device_code = ?").bind(body.device_code).run();
    throw badRequest("expired");
  }
  if (!row.session_token_hash) return c.json({ status: "pending" }, 202);

  // session_token_hash currently holds the raw token (see callback). Return it
  // once, then delete the row so it can't be replayed.
  const token = row.session_token_hash;
  await c.env.DB.prepare("DELETE FROM device_codes WHERE device_code = ?").bind(body.device_code).run();
  return c.json({ status: "complete", token });
});
