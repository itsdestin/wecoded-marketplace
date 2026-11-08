import { test } from "node:test";
import assert from "node:assert/strict";
import { getJson, redactUrl } from "../scripts/lib/http.js";

// WHY: error messages are printed into the chat; the user's api.data.gov key must never appear.
test("a failed request's error hides the API key", async () => {
  const fetch = async () => ({ ok: false, status: 500 });
  await assert.rejects(
    getJson("https://api.open.fec.gov/v1/candidates/?q=x&api_key=REAL-KEY-123&state=AZ", { fetch }),
    (err) => !err.message.includes("REAL-KEY-123") && err.message.includes("api_key=[hidden]") && err.message.includes("state=AZ"),
  );
});

test("redactUrl leaves URLs without keys unchanged", () => {
  assert.equal(redactUrl("https://example.org/a?b=1"), "https://example.org/a?b=1");
});
