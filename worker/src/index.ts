import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env, HonoEnv } from "./types";
import { authRoutes } from "./auth/routes";
import { installRoutes } from "./installs/routes";
import { ratingRoutes } from "./ratings/routes";
import { themeRoutes } from "./themes/routes";
import { statsRoutes } from "./stats/routes";
import { reportRoutes } from "./reports/routes";

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
app.route("/", themeRoutes);
app.route("/", statsRoutes);
app.route("/", reportRoutes);

export default app;
export type { Env };
