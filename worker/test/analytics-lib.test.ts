import { describe, it, expect, vi } from "vitest";
import { writeAppEvent } from "../src/lib/analytics";

describe("writeAppEvent", () => {
  it("no-ops when binding is missing", () => {
    // Must not throw when env.APP_ANALYTICS is undefined (test env shape).
    expect(() =>
      writeAppEvent(
        { APP_ANALYTICS: undefined as any } as any,
        {
          eventType: "install",
          installId: "00000000-0000-0000-0000-000000000000",
          appVersion: "1.2.1",
          platform: "desktop",
          os: "mac",
          country: "US",
        }
      )
    ).not.toThrow();
  });

  it("calls writeDataPoint with the expected blob order", () => {
    const writeDataPoint = vi.fn();
    writeAppEvent(
      { APP_ANALYTICS: { writeDataPoint } } as any,
      {
        eventType: "heartbeat",
        installId: "11111111-1111-1111-1111-111111111111",
        appVersion: "1.2.1",
        platform: "android",
        os: "",
        country: "DE",
      }
    );
    expect(writeDataPoint).toHaveBeenCalledWith({
      blobs: ["heartbeat", "11111111-1111-1111-1111-111111111111", "1.2.1", "android", "", "DE"],
      doubles: [],
      indexes: ["heartbeat"],
    });
  });
});
