import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { checkAlarms, sendAlarms } from "../src/security/alarms";
import { createTestAccount, issueTestSession } from "./helpers";

// WHY: these alarms are the only way Destin hears about an attack in progress; a query that
// silently matched nothing would look exactly like a quiet night.
describe("hourly security alarms", () => {
  const now = () => Math.floor(Date.now() / 1000);

  it("stays quiet on a normal hour", async () => {
    const alarms = await checkAlarms({ DB: env.DB, ADMIN_USER_IDS: "" }, now());
    expect(alarms).toEqual([]);
  });

  it("raises a sign-in burst past the limit, ignoring older starts", async () => {
    const t = now();
    const stmts = [];
    for (let i = 0; i < 5; i++) {
      stmts.push(env.DB.prepare("INSERT INTO device_codes (device_code, user_code, expires_at, created_at) VALUES (?, 'AAAA-AAAA', ?, ?)")
        .bind(`burst-${i}`, t + 900, t - 60));
    }
    stmts.push(env.DB.prepare("INSERT INTO device_codes (device_code, user_code, expires_at, created_at) VALUES ('old', 'AAAA-AAAA', ?, ?)")
      .bind(t, t - 7200));
    await env.DB.batch(stmts);
    const keys = (await checkAlarms({ DB: env.DB, ALARM_SIGNIN_START_LIMIT: "5" }, t)).map((a) => a.key);
    expect(keys).toContain("signin-burst");
    const quiet = (await checkAlarms({ DB: env.DB, ALARM_SIGNIN_START_LIMIT: "6" }, t)).map((a) => a.key);
    expect(quiet).not.toContain("signin-burst");
  });

  it("notices networks that hit the per-network sign-in cap", async () => {
    const t = now();
    const stmts = [];
    for (const bucket of ["b1", "b2", "b3"]) {
      for (let i = 0; i < 10; i++) {
        stmts.push(env.DB.prepare("INSERT INTO device_codes (device_code, user_code, expires_at, created_at, ip_bucket) VALUES (?, 'AAAA-AAAA', ?, ?, ?)")
          .bind(`${bucket}-${i}`, t + 900, t - 30, bucket));
      }
    }
    await env.DB.batch(stmts);
    expect((await checkAlarms({ DB: env.DB }, t)).map((a) => a.key)).toContain("signin-capped");
  });

  it("flags a new admin sign-in by GitHub id, and not other accounts", async () => {
    const someone = await createTestAccount({ githubId: "1111" });
    await issueTestSession(someone);
    expect((await checkAlarms({ DB: env.DB, ADMIN_USER_IDS: "424242" }, now())).map((a) => a.key)).not.toContain("admin-signin");
    const admin = await createTestAccount({ githubId: "424242" });
    await issueTestSession(admin);
    expect((await checkAlarms({ DB: env.DB, ADMIN_USER_IDS: "424242" }, now())).map((a) => a.key)).toContain("admin-signin");
  });

  it("raises a burst of new logins", async () => {
    const acct = await createTestAccount();
    for (let i = 0; i < 3; i++) await issueTestSession(acct);
    expect((await checkAlarms({ DB: env.DB, ALARM_NEW_SESSION_LIMIT: "3" }, now())).map((a) => a.key)).toContain("session-burst");
  });

  it("sends vague alerts only, and survives ntfy being down", async () => {
    const calls: { url: string; body: string; priority: string }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: String(init.body), priority: (init.headers as Record<string, string>).Priority ?? "" });
      return new Response("", { status: 200 });
    }) as unknown as typeof fetch;
    const alarm = { key: "signin-burst", priority: "high" as const, title: "Unusual sign-in activity on the YouCoded server", detail: "999 starts" };
    expect(await sendAlarms({ DB: env.DB, NTFY_TOPIC: "topic-x" }, [alarm], fake)).toBe(1);
    const [first] = calls;
    expect(first?.url).toBe("https://ntfy.sh/topic-x");
    expect(first?.body).not.toContain("999");
    expect(first?.priority).toBe("high");

    const broken = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    expect(await sendAlarms({ DB: env.DB, NTFY_TOPIC: "topic-x" }, [alarm, alarm], broken)).toBe(0);
    // Not configured: logs only, sends nothing.
    expect(await sendAlarms({ DB: env.DB }, [alarm], fake)).toBe(0);
  });
});

describe("game-room ticket alarm", () => {
  it("raises when tickets issued in the last hour reach the limit, ignoring older ones", async () => {
    const t = Math.floor(Date.now() / 1000);
    const stmts = [];
    for (let i = 0; i < 3; i++) {
      stmts.push(env.DB.prepare("INSERT INTO game_tickets (ticket_hash, user_id, username, game, room, created_at, expires_at) VALUES (?, 'u', 'u', 'chess', 'ROOMAA', ?, ?)")
        .bind(`h${i}`, t - 30, t + 30));
    }
    stmts.push(env.DB.prepare("INSERT INTO game_tickets (ticket_hash, user_id, username, game, room, created_at, expires_at) VALUES ('old', 'u', 'u', 'chess', 'ROOMAA', ?, ?)")
      .bind(t - 7200, t - 7100));
    await env.DB.batch(stmts);
    expect((await checkAlarms({ DB: env.DB, ALARM_GAME_TICKET_LIMIT: "3" }, t)).map((a) => a.key)).toContain("game-ticket-burst");
    expect((await checkAlarms({ DB: env.DB, ALARM_GAME_TICKET_LIMIT: "4" }, t)).map((a) => a.key)).not.toContain("game-ticket-burst");
  });
});
