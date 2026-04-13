import { Hono } from "hono";
import { cors } from "hono/cors";

export interface Env {
  DB: D1Database;
  AI: Ai;
  GH_CLIENT_ID: string;
  GH_CLIENT_SECRET: string;
  ADMIN_USER_IDS: string;
}

const app = new Hono<{ Bindings: Env }>();

app.use("*", cors({ origin: "*", allowMethods: ["GET", "POST", "DELETE"], allowHeaders: ["Content-Type", "Authorization"] }));

app.get("/health", (c) => c.json({ ok: true }));

export default app;
