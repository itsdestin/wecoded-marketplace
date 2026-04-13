// requireAuth: resolves a Bearer token to a userId via the sessions table and
// stashes it on the Hono context as `userId`. Throws 401 on missing/invalid.

import type { MiddlewareHandler } from "hono";
import type { HonoEnv } from "../types";
import { unauthorized } from "../lib/errors";
import { resolveSession } from "./sessions";

export const requireAuth: MiddlewareHandler<HonoEnv> = async (c, next) => {
  const header = c.req.header("Authorization");
  if (!header?.startsWith("Bearer ")) throw unauthorized();
  const token = header.slice(7);
  const userId = await resolveSession(c.env.DB, token);
  if (!userId) throw unauthorized("invalid token");
  c.set("userId", userId);
  await next();
};
