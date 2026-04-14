#!/usr/bin/env node

// build-integrations.js — read integrations/ source dir, emit integrations/index.json.
//
// V1 policy: the index.json is the canonical source. This script exists so
// that future per-integration source files (one per integration with its own
// setup.sh/README) can be assembled without hand-editing the aggregate index.
//
// Today it just round-trips the file through schema validation, giving CI a
// hook to catch malformed entries and giving us a place to hang future build
// logic.

const fs = require("fs");
const path = require("path");

const INDEX_PATH = path.join(__dirname, "..", "integrations", "index.json");

const REQUIRED_FIELDS = ["slug", "displayName", "tagline", "kind", "setup", "status"];
const ALLOWED_KINDS = new Set(["mcp", "shell", "http"]);
const ALLOWED_STATUSES = new Set(["available", "planned", "deprecated"]);
const ALLOWED_SETUP_TYPES = new Set(["script", "api-key", "macos-only"]);

function main() {
  const raw = JSON.parse(fs.readFileSync(INDEX_PATH, "utf8"));
  const entries = raw.integrations || [];

  const errors = [];
  const slugs = new Set();
  for (const e of entries) {
    for (const f of REQUIRED_FIELDS) {
      if (e[f] == null) errors.push(`${e.slug || "(no slug)"}: missing "${f}"`);
    }
    if (e.slug) {
      if (slugs.has(e.slug)) errors.push(`${e.slug}: duplicate slug`);
      slugs.add(e.slug);
    }
    if (e.kind && !ALLOWED_KINDS.has(e.kind)) {
      errors.push(`${e.slug}: kind "${e.kind}" not in ${[...ALLOWED_KINDS].join(", ")}`);
    }
    if (e.status && !ALLOWED_STATUSES.has(e.status)) {
      errors.push(`${e.slug}: status "${e.status}" not in ${[...ALLOWED_STATUSES].join(", ")}`);
    }
    if (e.setup?.type && !ALLOWED_SETUP_TYPES.has(e.setup.type)) {
      errors.push(`${e.slug}: setup.type "${e.setup.type}" unrecognized`);
    }
  }

  if (errors.length) {
    console.error("Integration validation failed:");
    for (const err of errors) console.error("  -", err);
    process.exit(1);
  }

  // Normalize + sort: available first, then planned, then deprecated.
  const rank = (s) => (s === "available" ? 0 : s === "planned" ? 1 : 2);
  entries.sort((a, b) => rank(a.status) - rank(b.status) || a.slug.localeCompare(b.slug));

  const out = {
    version: new Date().toISOString(),
    generatedBy: "build-integrations.js",
    integrations: entries,
  };
  fs.writeFileSync(INDEX_PATH, JSON.stringify(out, null, 2) + "\n");
  console.log(`OK: validated + wrote ${entries.length} integrations`);
}

main();
