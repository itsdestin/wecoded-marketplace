import { describe, it, expect } from "vitest";
import {
  adminFilterClause,
  cutoverClause,
  hideTestClause,
  historicalCiVersionClause,
  localTimestampExpr,
  platformClause,
  versionClause,
} from "../src/lib/admin-filter";

describe("adminFilterClause", () => {
  it("returns empty string when KNOWN_DEV_DEVICES is unset", () => {
    expect(adminFilterClause({ KNOWN_DEV_DEVICES: "" } as any, false)).toBe("");
    expect(adminFilterClause({ KNOWN_DEV_DEVICES: undefined } as any, false)).toBe("");
  });

  it("returns empty string when include_admins=true", () => {
    expect(adminFilterClause({ KNOWN_DEV_DEVICES: "a".repeat(64) } as any, true)).toBe("");
  });

  it("returns NOT IN clause for valid 64-hex hashes", () => {
    const env = {
      KNOWN_DEV_DEVICES: `${"a".repeat(64)},${"b".repeat(64)}`,
    } as any;
    const clause = adminFilterClause(env, false);
    expect(clause).toBe(`AND blob2 NOT IN ('${"a".repeat(64)}','${"b".repeat(64)}')`);
  });

  it("strips non-hex characters defensively", () => {
    const env = {
      KNOWN_DEV_DEVICES: `${"a".repeat(64)}'); DROP TABLE--`,
    } as any;
    const clause = adminFilterClause(env, false);
    // The injection attempt is reduced to hex chars only; the dropped string
    // becomes a < 64-char hash and is rejected by the length filter.
    expect(clause).toBe(`AND blob2 NOT IN ('${"a".repeat(64)}')`);
  });

  it("rejects hashes that aren't exactly 64 hex chars", () => {
    const env = {
      KNOWN_DEV_DEVICES: `short,${"a".repeat(64)},${"b".repeat(63)}`,
    } as any;
    const clause = adminFilterClause(env, false);
    expect(clause).toBe(`AND blob2 NOT IN ('${"a".repeat(64)}')`);
  });
});

describe("cutoverClause", () => {
  it("returns empty when CUTOVER_TIMESTAMP is unset", () => {
    expect(cutoverClause({ CUTOVER_TIMESTAMP: "" } as any)).toBe("");
    expect(cutoverClause({ CUTOVER_TIMESTAMP: undefined } as any)).toBe("");
  });

  it("returns AND clause when set", () => {
    expect(cutoverClause({ CUTOVER_TIMESTAMP: "2026-05-15T00:00:00Z" } as any))
      .toBe("AND timestamp > toDateTime('2026-05-15T00:00:00Z')");
  });

  it("strips characters that would break SQL string quoting", () => {
    // ISO 8601 chars only: digits, T, Z, :, -, .. Apostrophes and other risky
    // chars get filtered.
    expect(cutoverClause({ CUTOVER_TIMESTAMP: "2026-05-15'); DROP--" } as any))
      .toBe("AND timestamp > toDateTime('2026-05-15')");
  });
});

describe("localTimestampExpr", () => {
  it("falls back to plain timestamp when unset, empty or zero", () => {
    expect(localTimestampExpr(undefined)).toBe("timestamp");
    expect(localTimestampExpr("")).toBe("timestamp");
    expect(localTimestampExpr("0")).toBe("timestamp");
    expect(localTimestampExpr("-0")).toBe("timestamp");
  });

  it("adds positive offsets as a quoted MINUTE interval", () => {
    expect(localTimestampExpr("60")).toBe("(timestamp + INTERVAL '60' MINUTE)");
    expect(localTimestampExpr("840")).toBe("(timestamp + INTERVAL '840' MINUTE)");
  });

  it("subtracts the absolute value of negative offsets", () => {
    expect(localTimestampExpr("-300")).toBe("(timestamp - INTERVAL '300' MINUTE)");
    expect(localTimestampExpr("-840")).toBe("(timestamp - INTERVAL '840' MINUTE)");
  });

  it("emits normalized digits, not the raw input", () => {
    expect(localTimestampExpr("0060")).toBe("(timestamp + INTERVAL '60' MINUTE)");
  });

  it("rejects offsets outside ±840", () => {
    expect(localTimestampExpr("841")).toBe("timestamp");
    expect(localTimestampExpr("-841")).toBe("timestamp");
    expect(localTimestampExpr("9999")).toBe("timestamp");
  });

  it("rejects non-integer shapes and injection attempts", () => {
    for (const bad of [
      "abc", "1.5", "1e3", " 60", "60 ", "+60", "60\n", "00060", "--60",
      "60' MINUTE) OR 1=1 --", "60; DROP TABLE x", "0x3c", "Infinity",
    ]) {
      expect(localTimestampExpr(bad)).toBe("timestamp");
    }
  });
});

describe("platformClause", () => {
  it("accepts exactly desktop or android", () => {
    expect(platformClause("desktop")).toBe("AND blob4 = 'desktop'");
    expect(platformClause("android")).toBe("AND blob4 = 'android'");
  });

  it("drops anything else, including case variants and injection", () => {
    for (const bad of [
      undefined, "", "ios", "Desktop", "ANDROID", " desktop", "desktop ",
      "desktop' OR '1'='1", "android'; DROP TABLE x --",
    ]) {
      expect(platformClause(bad)).toBe("");
    }
  });
});

describe("versionClause", () => {
  it("accepts semver-like versions incl. prerelease and build suffixes", () => {
    expect(versionClause("1.2.3")).toBe("AND blob3 = '1.2.3'");
    expect(versionClause("1.4.0-releasetest")).toBe("AND blob3 = '1.4.0-releasetest'");
    expect(versionClause("1.4.0+abc.1")).toBe("AND blob3 = '1.4.0+abc.1'");
    expect(versionClause("v".repeat(64))).toBe(`AND blob3 = '${"v".repeat(64)}'`);
  });

  it("drops empty, over-long and out-of-charset values", () => {
    for (const bad of [
      undefined, "", "v".repeat(65), "1.0 beta", "1.0'", "1';DROP", "1.0\\",
      "1.0;--", "1.0' OR '1'='1", "1.0\n", "1.0%",
    ]) {
      expect(versionClause(bad)).toBe("");
    }
  });
});

describe("historicalCiVersionClause", () => {
  it("excludes exactly the user-approved historical versions", () => {
    expect(historicalCiVersionClause()).toBe(
      "AND blob3 NOT IN ('1.2.4-releasetest','1.3.0-beta','1.3.0-beta.71','1.3.0-beta.73','1.3.0-beta.74','1.3.0-beta.77','1.3.0-beta.78','1.3.0-beta.79','1.3.0-beta.81','1.3.0-beta.84','1.3.0-beta.85','1.3.0-beta.86')"
    );
  });

  it("preserves the published prereleases that were not selected for removal", () => {
    const clause = historicalCiVersionClause();
    for (const version of [
      "1.3.0-beta.72",
      "1.3.0-beta.75",
      "1.3.0-beta.76",
      "1.3.0-beta.80",
      "1.3.1-beta.87",
    ]) {
      expect(clause).not.toContain(`'${version}'`);
    }
  });
});

describe("hideTestClause", () => {
  it("excludes -releasetest and -dev builds when exactly '1'", () => {
    expect(hideTestClause("1"))
      .toBe("AND blob3 NOT LIKE '%-releasetest' AND blob3 NOT LIKE '%-dev'");
  });

  it("is empty for anything else", () => {
    for (const other of [undefined, "", "0", "true", "yes", " 1", "1'; DROP"]) {
      expect(hideTestClause(other)).toBe("");
    }
  });
});
