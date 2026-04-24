// Serves the admin dashboard HTML. Gated by requireAdminAuth so only
// authenticated callers can load the page. The dashboard's in-page fetches
// to /admin/analytics/* carry the browser session cookie via credentials:
// same-origin and are each admin-gated individually.
import { Hono } from "hono";
import type { HonoEnv } from "../types";
import { requireAdminAuth } from "../auth/admin-middleware";
import { dashboardHtml } from "./dashboard-html";

export const adminDashboardRoute = new Hono<HonoEnv>();

adminDashboardRoute.get("/admin/dashboard", requireAdminAuth, (c) => {
  return c.html(dashboardHtml);
});
