#!/usr/bin/env node

// sync.js — Populate index.json with upstream Anthropic marketplace plugins.
//
// Usage: node scripts/sync.js [--local <path-to-marketplace-repo>]
//
// By default fetches marketplace.json from GitHub. With --local, reads from
// a local clone of anthropics/claude-plugins-official.

const fs = require("fs");
const path = require("path");
const https = require("https");

const INDEX_PATH = path.join(__dirname, "..", "index.json");
const OVERRIDES_DIR = path.join(__dirname, "..", "overrides");

const UPSTREAM_RAW_URL =
  "https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/.claude-plugin/marketplace.json";

// IDs reserved for DestinClaude entries — never overwritten by upstream sync.
// Loaded dynamically from existing index.json entries with sourceMarketplace === "destinclaude".
let DESTINCLAUDE_IDS = new Set();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function titleCase(kebab) {
  // Known acronyms that should stay uppercase
  const acronyms = new Set(["ai", "api", "aws", "ci", "cd", "cli", "cms", "css", "db", "dba",
    "dns", "gcp", "gpu", "html", "http", "ide", "js", "json", "jwt", "lsp", "mcp", "ml",
    "npm", "pdf", "pr", "qa", "sdk", "sql", "ssh", "ssl", "tls", "ui", "url", "ux", "xml"]);
  return kebab
    .split("-")
    .map((w) => {
      const lower = w.toLowerCase();
      if (acronyms.has(lower)) return w.toUpperCase();
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(" ");
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const get = (u) => {
      https
        .get(u, { headers: { "User-Agent": "destincode-marketplace-sync" } }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            get(res.headers.location);
            return;
          }
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode} for ${u}`));
            return;
          }
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              reject(new Error(`JSON parse error: ${e.message}`));
            }
          });
        })
        .on("error", reject);
    };
    get(url);
  });
}

function parseSource(upstream) {
  const src = upstream.source;
  if (typeof src === "string") {
    // Local path within the marketplace repo
    return { sourceType: "local", sourceRef: src };
  }
  if (src && src.source === "url") {
    return { sourceType: "url", sourceRef: src.url };
  }
  if (src && src.source === "git-subdir") {
    return {
      sourceType: "git-subdir",
      sourceRef: src.url.startsWith("http") ? src.url : `https://github.com/${src.url}.git`,
      sourceSubdir: src.path,
    };
  }
  if (src && src.source === "github") {
    return { sourceType: "url", sourceRef: `https://github.com/${src.repo}.git` };
  }
  // Unknown source type — include it anyway with a marker
  return { sourceType: "unknown", sourceRef: JSON.stringify(src) };
}

function loadOverride(id) {
  const overridePath = path.join(OVERRIDES_DIR, `${id}.json`);
  if (fs.existsSync(overridePath)) {
    try {
      return JSON.parse(fs.readFileSync(overridePath, "utf8"));
    } catch (e) {
      console.warn(`  WARNING: bad override file ${overridePath}: ${e.message}`);
    }
  }
  return null;
}

function mapUpstreamEntry(upstream, marketplaceName, ownerName) {
  const id = upstream.name;
  const sourceInfo = parseSource(upstream);

  const entry = {
    id,
    type: "plugin",
    displayName: titleCase(id),
    description: upstream.description || "",
    category: upstream.category || "other",
    author: upstream.author?.name || ownerName || marketplaceName,
    tags: [],
    version: "1.0.0",
    publishedAt: new Date().toISOString().split("T")[0] + "T00:00:00Z",
    sourceMarketplace: marketplaceName,
    ...sourceInfo,
    repoUrl: upstream.homepage || null,
  };

  // Apply overrides
  const override = loadOverride(id);
  if (override) {
    Object.assign(entry, override);
    // Never let overrides change these structural fields
    entry.id = id;
    entry.sourceMarketplace = marketplaceName;
  }

  return entry;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // Parse args
  let localPath = null;
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--local" && args[i + 1]) {
      localPath = args[++i];
    }
  }

  // Load existing index
  let existingIndex = [];
  if (fs.existsSync(INDEX_PATH)) {
    existingIndex = JSON.parse(fs.readFileSync(INDEX_PATH, "utf8"));
  }

  // Separate DestinClaude entries (preserved as-is)
  const destinclaude = existingIndex.filter(
    (e) => e.sourceMarketplace === "destinclaude" || !e.sourceMarketplace
  );
  DESTINCLAUDE_IDS = new Set(destinclaude.map((e) => e.id));

  console.log(`Existing DestinClaude entries: ${destinclaude.length}`);

  // Fetch upstream marketplace.json
  let marketplace;
  if (localPath) {
    const mpPath = path.join(localPath, ".claude-plugin", "marketplace.json");
    if (!fs.existsSync(mpPath)) {
      console.error(`marketplace.json not found at ${mpPath}`);
      process.exit(1);
    }
    marketplace = JSON.parse(fs.readFileSync(mpPath, "utf8"));
    console.log(`Loaded marketplace.json from local path: ${mpPath}`);
  } else {
    console.log(`Fetching marketplace.json from GitHub...`);
    marketplace = await fetchJson(UPSTREAM_RAW_URL);
  }

  const upstreamPlugins = marketplace.plugins || [];
  console.log(`Upstream plugins found: ${upstreamPlugins.length}`);

  // Validate upstream schema
  const valid = upstreamPlugins.filter((p) => p.name && p.source);
  const invalid = upstreamPlugins.length - valid.length;
  if (invalid > 0) {
    const pct = (invalid / upstreamPlugins.length) * 100;
    console.warn(`  WARNING: ${invalid} entries missing name or source (${pct.toFixed(1)}%)`);
    if (pct > 20) {
      console.error("  ABORT: >20% invalid entries — upstream schema may have changed");
      process.exit(1);
    }
  }

  // Map upstream entries, skipping DestinClaude IDs
  const marketplaceName = marketplace.name || "claude-plugins-official";
  const ownerName = marketplace.owner?.name || "Anthropic";
  const mapped = [];
  const skipped = [];

  for (const upstream of valid) {
    if (DESTINCLAUDE_IDS.has(upstream.name)) {
      skipped.push(upstream.name);
      continue;
    }
    mapped.push(mapUpstreamEntry(upstream, marketplaceName, ownerName));
  }

  if (skipped.length > 0) {
    console.log(`Skipped (conflicts with DestinClaude IDs): ${skipped.join(", ")}`);
  }

  // Deduplicate mapped entries by id
  const seen = new Set();
  const deduped = [];
  for (const entry of mapped) {
    if (seen.has(entry.id)) {
      console.warn(`  Duplicate id "${entry.id}" — keeping first occurrence`);
      continue;
    }
    seen.add(entry.id);
    deduped.push(entry);
  }

  // Combine: DestinClaude first, then upstream (sorted alphabetically)
  const upstream = deduped.sort((a, b) => a.id.localeCompare(b.id));
  const combined = [...destinclaude, ...upstream];

  // Final validation
  const errors = [];
  const allIds = new Set();
  for (const entry of combined) {
    if (!entry.id) errors.push("Entry missing id");
    if (!entry.type) errors.push(`${entry.id}: missing type`);
    if (!entry.displayName) errors.push(`${entry.id}: missing displayName`);
    if (!entry.description) errors.push(`${entry.id}: missing description`);
    if (allIds.has(entry.id)) errors.push(`${entry.id}: duplicate id`);
    allIds.add(entry.id);
  }
  if (errors.length > 0) {
    console.warn("Validation warnings:");
    errors.forEach((e) => console.warn(`  - ${e}`));
  }

  // Write
  fs.writeFileSync(INDEX_PATH, JSON.stringify(combined, null, 2) + "\n");

  // Summary
  const bySource = {};
  for (const e of combined) {
    const src = e.sourceMarketplace || "destinclaude";
    bySource[src] = (bySource[src] || 0) + 1;
  }
  console.log(`\nWritten ${combined.length} entries to index.json`);
  console.log("By source:", JSON.stringify(bySource));

  const byType = {};
  for (const e of combined) {
    const t = e.sourceType || e.type;
    byType[t] = (byType[t] || 0) + 1;
  }
  console.log("By source type:", JSON.stringify(byType));
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
