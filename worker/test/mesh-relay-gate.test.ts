/// <reference types="vite/client" />
import { env, createExecutionContext, waitOnExecutionContext, listDurableObjectIds } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker from "../src/index";
import wranglerToml from "../wrangler.toml?raw";
import { Conn, newDevice } from "./mesh-helpers";
import { meshRelayEnabled, roomAllowed } from "../src/mesh/routes";

// The off switch. Worker deploys happen automatically from master, so the relay must be unreachable unless
// MESH_RELAY_ENABLED is exactly "1", and with it off no Durable Object may be created.

/** A stand-in for the Durable Object binding that records every touch and refuses to hand out an object. */
function spyNamespace() {
  const touched: string[] = [];
  const ns = {
    touched,
    idFromName(name: string) { touched.push(`idFromName:${name.slice(0, 8)}`); return { name } as any; },
    get() { touched.push("get"); return { fetch: async () => new Response("reached the room", { status: 200 }) } as any; },
  };
  return ns;
}
const room = "ab".repeat(32);
async function call(extraEnv: Record<string, unknown>, path = `/mesh/relay/${room}?v=1`, headers: Record<string, string> = { Upgrade: "websocket" }) {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(`https://test.local${path}`, { headers }), { ...env, ...extraEnv } as any, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

describe("feature flag", () => {
  for (const off of ["0", "", "true", "yes", "01", " 1", "1 ", undefined]) {
    it(`flag ${JSON.stringify(off)}: every relay route is a plain 404 and no object is created or touched`, async () => {
      const spy = spyNamespace();
      const before = (await listDurableObjectIds(env.MESH_RELAY)).length;
      for (const path of [`/mesh/relay/${room}?v=1`, `/mesh/relay/${room}`, "/mesh/relay/short", "/mesh/relay/", "/mesh/relay"]) {
        const res = await call({ MESH_RELAY_ENABLED: off, MESH_RELAY: spy }, path);
        expect(res.status).toBe(404);
      }
      // a non-upgrade request is a 404 too, not a "websocket only" hint that reveals the route exists
      expect((await call({ MESH_RELAY_ENABLED: off, MESH_RELAY: spy }, `/mesh/relay/${room}?v=1`, {})).status).toBe(404);
      expect(spy.touched).toEqual([]);
      expect(await listDurableObjectIds(env.MESH_RELAY)).toHaveLength(before);
    });
  }

  it("flag off answers exactly what an unknown path answers (the route's existence is not revealed)", async () => {
    const off = await call({ MESH_RELAY_ENABLED: "0", MESH_RELAY: spyNamespace() });
    const unknown = await call({}, "/mesh/not-a-route");
    expect(off.status).toBe(unknown.status);
    expect(await off.text()).toBe(await unknown.text());
  });

  it("flag \"1\" reaches the room object for a valid room", async () => {
    const spy = spyNamespace();
    const res = await call({ MESH_RELAY_ENABLED: "1", MESH_RELAY: spy });
    expect(res.status).toBe(200);
    expect(spy.touched).toEqual([`idFromName:${room.slice(0, 8)}`, "get"]);
  });

  it("with the flag on, a malformed room or a plain GET never reaches an object", async () => {
    const spy = spyNamespace();
    expect((await call({ MESH_RELAY_ENABLED: "1", MESH_RELAY: spy }, "/mesh/relay/not-hex")).status).toBe(404);
    expect((await call({ MESH_RELAY_ENABLED: "1", MESH_RELAY: spy }, `/mesh/relay/${"AB".repeat(32)}?v=1`)).status).toBe(404); // upper case is not a valid id
    expect((await call({ MESH_RELAY_ENABLED: "1", MESH_RELAY: spy }, `/mesh/relay/${room}?v=1`, {})).status).toBe(426);
    expect(spy.touched).toEqual([]);
  });

  it("the test environment has the relay on (the rest of this suite relies on it)", () => {
    expect(env.MESH_RELAY_ENABLED).toBe("1");
    expect(meshRelayEnabled({ MESH_RELAY_ENABLED: "1" })).toBe(true);
    expect(meshRelayEnabled({})).toBe(false);
  });
});

describe("production configuration is pinned off", () => {
  // WHY a line-anchored search: comments earlier in the file mention "[env.test]" in prose.
  const split = wranglerToml.search(/^\[env\.test\]\s*$/m);
  const prod = wranglerToml.slice(0, split);
  const test = wranglerToml.slice(split);
  it("wrangler.toml sets MESH_RELAY_ENABLED = \"0\" for production and \"1\" only in [env.test]", () => {
    expect(prod.match(/^MESH_RELAY_ENABLED\s*=\s*"([^"]*)"/m)?.[1]).toBe("0");
    expect(test.match(/^MESH_RELAY_ENABLED\s*=\s*"([^"]*)"/m)?.[1]).toBe("1");
    expect(prod.match(/^MESH_RELAY_ENABLED/gm)).toHaveLength(1);
  });
  it("the Durable Object binding is mirrored into [env.test] and the class is registered by a migration", () => {
    expect(prod).toMatch(/name = "MESH_RELAY", class_name = "MeshRelayRoom"/);
    expect(test).toMatch(/name = "MESH_RELAY", class_name = "MeshRelayRoom"/);
    expect(wranglerToml).toMatch(/new_sqlite_classes = \["MeshRelayRoom"\]/);
  });
  it("no allow-list or other var turns the relay on in production config", () => {
    expect(prod).not.toMatch(/^MESH_ALLOWED_ROOMS/m);
  });
});

describe("test-relay allow-list", () => {
  it("unset or blank allows any room; a list allows only the named rooms", () => {
    expect(roomAllowed({}, room)).toBe(true);
    expect(roomAllowed({ MESH_ALLOWED_ROOMS: "  " }, room)).toBe(true);
    expect(roomAllowed({ MESH_ALLOWED_ROOMS: `${"cd".repeat(32)}, ${room}` }, room)).toBe(true);
    expect(roomAllowed({ MESH_ALLOWED_ROOMS: "cd".repeat(32) }, room)).toBe(false);
  });
  it("an unlisted room is a 404 and creates no object", async () => {
    const spy = spyNamespace();
    expect((await call({ MESH_ALLOWED_ROOMS: "cd".repeat(32), MESH_RELAY: spy })).status).toBe(404);
    expect(spy.touched).toEqual([]);
  });
});

describe("headers the room trusts cannot be set by a client", () => {
  it("the challenge names the real host and room, whatever X-Mesh-* headers the client sends", async () => {
    const d = await newDevice();
    const c = await Conn.open(d.room, { headers: { "X-Mesh-Aud": "evil.example", "X-Mesh-Room": "cd".repeat(32), "X-Mesh-Ip": "1.2.3.4" } });
    // Signing for the REAL host succeeds only if the relay used the real host, not the client's header.
    expect((await c.auth(d, { firstDevice: true, aud: "test.local" })).h.r).toBe("ok");
  });
});
