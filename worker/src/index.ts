import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { cors } from "hono/cors";
import type { Env, HonoEnv } from "./types";
import { authRoutes } from "./auth/routes";
import { installRoutes } from "./installs/routes";
import { ratingRoutes } from "./ratings/routes";
import { themeRoutes } from "./themes/routes";
import { statsRoutes } from "./stats/routes";
import { reportRoutes } from "./reports/routes";
import { appRoutes } from "./app/routes";
import { adminAnalyticsRoutes } from "./admin/analytics";
import { adminDashboardRoute } from "./admin/dashboard-route";

const app = new Hono<HonoEnv>();

// Allowlist of origins permitted to call the worker. Keep this tight — these
// are the only surfaces that should legitimately talk to the marketplace API.
const ALLOWED_ORIGINS = [
  "https://youcoded.com",
  "app://youcoded",          // Electron packaged app
  "http://localhost:5173",     // desktop dev
  "http://localhost:5223",     // desktop dev (offset via YOUCODED_PORT_OFFSET=50)
  "http://localhost:9901",     // Android LocalBridgeServer
];

app.use("*", cors({
  origin: (origin) => (ALLOWED_ORIGINS.includes(origin ?? "") ? origin! : null),
  allowMethods: ["GET", "POST", "DELETE"],
  allowHeaders: ["Content-Type", "Authorization"],
  credentials: false,
}));

// Error handler: HTTPException responses (badRequest, forbidden, tooMany, etc.)
// keep their own status+body. Any other thrown Error becomes JSON 500 instead
// of Hono's default plain-text so admin-skill + dashboard callers can parse the
// message — and so the admin analytics SQL-API errors are debuggable in prod.
app.onError((err, c) => {
  if (err instanceof HTTPException) return err.getResponse();
  const message = err instanceof Error ? err.message : "internal error";
  console.error("worker onError:", message);
  return c.json({ ok: false, error: message }, 500);
});

app.get("/health", (c) => c.json({ ok: true }));
app.route("/", authRoutes);
app.route("/", installRoutes);
app.route("/", ratingRoutes);
app.route("/", themeRoutes);
app.route("/", statsRoutes);
app.route("/", reportRoutes);
app.route("/", appRoutes);
app.route("/", adminAnalyticsRoutes);
app.route("/", adminDashboardRoute);

export default app;
export type { Env };
