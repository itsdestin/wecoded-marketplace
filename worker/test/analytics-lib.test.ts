import { describe, it, expect, vi } from "vitest";
import { writeAppEvent } from "../src/lib/analytics";

describe("writeAppEvent", () => {
  it("no-ops when binding is missing", () => {
    // Must not throw when env.APP_ANALYTICS is undefined (test env shape).
    expect(() =>
      writeAppEvent(
        { APP_ANALYTICS: undefined as any } as any,
        {
          deviceIdHash: "a".repeat(64),
          appVersion: "1.2.1",
          platform: "desktop",
          os: "mac",
          country: "US",
          region: "",
        }
      )
    ).not.toThrow();
  });

  it("calls writeDataPoint with the expected blob order", () => {
    const writeDataPoint = vi.fn();
    writeAppEvent(
      { APP_ANALYTICS: { writeDataPoint } } as any,
      {
        deviceIdHash: "a".repeat(64),
        appVersion: "1.2.1",
        platform: "android",
        os: "",
        country: "DE",
        region: "",
      }
    );
    expect(writeDataPoint).toHaveBeenCalledWith({
      blobs: ["heartbeat", "a".repeat(64), "1.2.1", "android", "", "DE", "", "", ""],
      doubles: [],
      indexes: ["heartbeat"],
    });
  });

  it("writes blob7 region when present in payload", () => {
    const writes: any[] = [];
    const env = {
      APP_ANALYTICS: { writeDataPoint: (dp: any) => writes.push(dp) },
    } as any;
    writeAppEvent(env, {
      deviceIdHash: "a".repeat(64),
      appVersion: "1.3.0",
      platform: "desktop",
      os: "mac",
      country: "US",
      region: "US-CA",
    });
    expect(writes).toHaveLength(1);
    expect(writes[0].blobs).toEqual([
      "heartbeat",
      "a".repeat(64),
      "1.3.0",
      "desktop",
      "mac",
      "US",
      "US-CA",
      "",
      "",
    ]);
  });

  it("marks a team device in blob8 and a milestone's name in blob9", () => {
    const writeDataPoint = vi.fn();
    writeAppEvent({ APP_ANALYTICS: { writeDataPoint } } as any, {
      kind: "milestone",
      deviceIdHash: "a".repeat(64),
      appVersion: "1.4.0",
      platform: "android",
      os: "",
      country: "",
      region: "",
      team: true,
      detail: "setup_done",
    });
    expect(writeDataPoint).toHaveBeenCalledWith({
      blobs: ["milestone", "a".repeat(64), "1.4.0", "android", "", "", "", "team", "setup_done"],
      doubles: [],
      indexes: ["milestone"],
    });
  });
});
