import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env, HonoEnv } from "./types";
import { authRoutes } from "./auth/routes";
import { installRoutes } from "./installs/routes";
import { ratingRoutes } from "./ratings/routes";

const app = new Hono<HonoEnv>();

app.use("*", cors({
  origin: "*",
  allowMethods: ["GET", "POST", "DELETE"],
  allowHeaders: ["Content-Type", "Authorization"],
}));

app.get("/health", (c) => c.json({ ok: true }));
app.route("/", authRoutes);
app.route("/", installRoutes);
app.route("/", ratingRoutes);

export default app;
export type { Env };
