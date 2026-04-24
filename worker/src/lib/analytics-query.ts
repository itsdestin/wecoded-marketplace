// SQL-over-HTTP client for Cloudflare Analytics Engine.
// Docs: https://developers.cloudflare.com/analytics/analytics-engine/sql-api/
// Admin-only caller — never expose this to public routes.
//
// CF_ANALYTICS_TOKEN is a narrow Analytics-Engine-Read scoped token,
// distinct from the broader CF_API_TOKEN used at deploy time.
import type { Env } from "../types";

interface AEResponse<T> {
  meta: Array<{ name: string; type: string }>;
  data: T[];
}

export async function runAnalyticsQuery<T = Record<string, unknown>>(
  env: Env,
  sql: string
): Promise<T[]> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/analytics_engine/sql`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.CF_ANALYTICS_TOKEN}`,
      "Content-Type": "text/plain",  // AE SQL API takes raw SQL, not JSON
    },
    body: sql,
  });
  if (!res.ok) {
    // Don't echo raw response body (may contain SQL text); CF observability
    // logs the full error. Keep the thrown message short on purpose.
    throw new Error(`analytics query failed: ${res.status}`);
  }
  const body = (await res.json()) as AEResponse<T>;
  return body.data;
}
