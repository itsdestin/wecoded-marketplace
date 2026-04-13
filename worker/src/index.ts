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

// Allowlist of origins permitted to call the worker. Keep this tight — these
// are the only surfaces that should legitimately talk to the marketplace API.
const ALLOWED_ORIGINS = [
  "https://destincode.com",
  "app://destincode",          // Electron packaged app
  "http://localhost:5173",     // desktop dev
  "http://localhost:5223",     // desktop dev (offset via DESTINCODE_PORT_OFFSET=50)
  "http://localhost:9901",     // Android LocalBridgeServer
];

app.use("*", cors({
  origin: (origin) => (ALLOWED_ORIGINS.includes(origin ?? "") ? origin! : null),
  allowMethods: ["GET", "POST", "DELETE"],
  allowHeaders: ["Content-Type", "Authorization"],
  credentials: false,
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
