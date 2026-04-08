#!/usr/bin/env node

// sync.js — Build skills/index.json from two sources:
//   1. Local marketplace.json (DestinCode/community entries)
//   2. Anthropic's marketplace.json (fetched from GitHub or --local path)
//
// Usage:
//   node scripts/sync.js                          # fetch upstream from GitHub
//   node scripts/sync.js --local <repo-path>      # read from local clone
//   node scripts/sync.js --local-hash             # compute content hashes for local plugins
//
// Key behaviors:
//   - Diffs against previous skills/index.json to detect changes
//   - Bumps patch version when entry metadata or SHA changes
//   - Flags removed upstream entries as deprecated (never deletes)
//   - Preserves upstream SHA for url/git-subdir entries
//   - Idempotent: no-change runs produce identical output
//   - Adds top-level version timestamp to generated index

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const https = require("https");

const SKILLS_INDEX_PATH = path.join(__dirname, "..", "skills", "index.json");
const LOCAL_MARKETPLACE_PATH = path.join(__dirname, "..", "marketplace.json");
const OVERRIDES_DIR = path.join(__dirname, "..", "overrides");

const UPSTREAM_RAW_URL =
  "https://raw.githubusercontent.com/anthropics/claude-plugins-official/main/.claude-plugin/marketplace.json";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function titleCase(kebab) {
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

// Bump patch version: "1.0.0" -> "1.0.1", "1.2.3" -> "1.2.4"
function bumpPatch(version) {
  const parts = (version || "1.0.0").split(".");
  if (parts.length !== 3) return "1.0.1";
  parts[2] = String(parseInt(parts[2], 10) + 1);
  return parts.join(".");
}

// Compute a stable content hash for a directory (for local plugin change detection)
function hashDirectory(dirPath) {
  const hash = crypto.createHash("sha256");
  const entries = [];

  function walk(dir, prefix) {
    for (const name of fs.readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        // Skip .git and node_modules
        if (name === ".git" || name === "node_modules") continue;
        walk(full, rel);
      } else {
        entries.push(rel);
        hash.update(rel);
        hash.update(fs.readFileSync(full));
      }
    }
  }

  try {
    walk(dirPath, "");
  } catch (e) {
    return null; // Directory doesn't exist or isn't readable
  }
  return hash.digest("hex").slice(0, 12); // Short hash is sufficient
}

// ---------------------------------------------------------------------------
// Source parsing — extracts install info from upstream source field
// ---------------------------------------------------------------------------

function parseSource(upstream) {
  const src = upstream.source;
  if (typeof src === "string") {
    return { sourceType: "local", sourceRef: src };
  }
  if (src && src.source === "url") {
    // Preserve upstream SHA for future update detection
    const result = { sourceType: "url", sourceRef: src.url };
    if (src.sha) result.sourceSha = src.sha;
    return result;
  }
  if (src && src.source === "git-subdir") {
    // Preserve upstream SHA and ref (branch) for future update detection
    const result = {
      sourceType: "git-subdir",
      sourceRef: src.url.startsWith("http") ? src.url : `https://github.com/${src.url}.git`,
      sourceSubdir: src.path,
    };
    if (src.sha) result.sourceSha = src.sha;
    if (src.ref) result.sourceGitRef = src.ref;
    return result;
  }
  if (src && src.source === "github") {
    return { sourceType: "url", sourceRef: `https://github.com/${src.repo}.git` };
  }
  return { sourceType: "unknown", sourceRef: JSON.stringify(src) };
}

// ---------------------------------------------------------------------------
// Entry mapping — converts a catalog entry to an index entry
// ---------------------------------------------------------------------------

function mapEntry(upstream, sourceMarketplace, ownerName, isPrompt) {
  const id = upstream.name;

  const entry = {
    id,
    type: isPrompt ? "prompt" : "plugin",
    displayName: upstream.displayName || titleCase(id),
    description: upstream.description || "",
    category: upstream.category || "other",
    author: upstream.author?.name || ownerName,
    tags: upstream.tags || [],
    version: "1.0.0",
    publishedAt: new Date().toISOString().split("T")[0] + "T00:00:00Z",
    sourceMarketplace,
  };

  if (isPrompt) {
    entry.prompt = upstream.prompt || "";
    if (upstream.authorGithub || upstream.author?.github) {
      entry.authorGithub = upstream.authorGithub || upstream.author.github;
    }
  } else {
    // Plugin — extract source info
    const sourceInfo = parseSource(upstream);
    Object.assign(entry, sourceInfo);
    entry.repoUrl = upstream.homepage || null;
  }

  // Apply overrides (never override structural fields)
  const override = loadOverride(id);
  if (override) {
    Object.assign(entry, override);
    entry.id = id;
    entry.sourceMarketplace = sourceMarketplace;
  }

  return entry;
}

// Check if two entries have meaningful differences (ignoring version/publishedAt)
function hasChanges(oldEntry, newEntry) {
  // Fields that indicate real content changes
  const compareKeys = [
    "description", "category", "author", "displayName",
    "sourceType", "sourceRef", "sourceSubdir", "sourceSha", "sourceGitRef",
    "repoUrl", "prompt", "tags",
  ];
  for (const key of compareKeys) {
    const oldVal = JSON.stringify(oldEntry[key] ?? null);
    const newVal = JSON.stringify(newEntry[key] ?? null);
    if (oldVal !== newVal) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // Parse args
  let localPath = null;
  let computeLocalHash = false;
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--local" && args[i + 1]) {
      localPath = args[++i];
    }
    if (args[i] === "--local-hash") {
      computeLocalHash = true;
    }
  }

  // Ensure skills/ directory exists
  const skillsDir = path.dirname(SKILLS_INDEX_PATH);
  if (!fs.existsSync(skillsDir)) {
    fs.mkdirSync(skillsDir, { recursive: true });
  }

  // Load previous index for diffing
  let previousIndex = [];
  if (fs.existsSync(SKILLS_INDEX_PATH)) {
    try {
      const prev = JSON.parse(fs.readFileSync(SKILLS_INDEX_PATH, "utf8"));
      previousIndex = prev.entries || prev; // Handle both wrapped and raw formats
    } catch (e) {
      console.warn(`WARNING: could not read previous index: ${e.message}`);
    }
  }
  const previousById = new Map(previousIndex.map(e => [e.id, e]));
  console.log(`Previous index: ${previousIndex.length} entries`);

  // --- Source 1: Local marketplace.json (DestinCode/community) ---
  let localMarketplace = { plugins: [] };
  if (fs.existsSync(LOCAL_MARKETPLACE_PATH)) {
    localMarketplace = JSON.parse(fs.readFileSync(LOCAL_MARKETPLACE_PATH, "utf8"));
    console.log(`Local marketplace.json: ${(localMarketplace.plugins || []).length} entries`);
  } else {
    console.warn("WARNING: no marketplace.json found — DestinCode entries will come from previous index");
  }

  const localEntries = [];
  for (const upstream of (localMarketplace.plugins || [])) {
    const isPrompt = upstream.type === "prompt";
    const entry = mapEntry(upstream, "destincode", localMarketplace.owner?.name || "DestinCode", isPrompt);

    // For local-source plugins, compute content hash if flag is set
    if (computeLocalHash && !isPrompt && entry.sourceType === "local") {
      const pluginDir = path.join(__dirname, "..", entry.sourceRef);
      const hash = hashDirectory(pluginDir);
      if (hash) entry.sourceSha = hash;
    }

    localEntries.push(entry);
  }

  const localIds = new Set(localEntries.map(e => e.id));
  console.log(`DestinCode entries mapped: ${localEntries.length}`);

  // --- Source 2: Upstream Anthropic marketplace.json ---
  let upstreamMarketplace;
  if (localPath) {
    const mpPath = path.join(localPath, ".claude-plugin", "marketplace.json");
    if (!fs.existsSync(mpPath)) {
      console.error(`marketplace.json not found at ${mpPath}`);
      process.exit(1);
    }
    upstreamMarketplace = JSON.parse(fs.readFileSync(mpPath, "utf8"));
    console.log(`Upstream from local path: ${mpPath}`);
  } else {
    console.log(`Fetching upstream marketplace.json from GitHub...`);
    upstreamMarketplace = await fetchJson(UPSTREAM_RAW_URL);
  }

  const upstreamPlugins = upstreamMarketplace.plugins || [];
  const marketplaceName = upstreamMarketplace.name || "claude-plugins-official";
  const ownerName = upstreamMarketplace.owner?.name || "Anthropic";
  console.log(`Upstream plugins found: ${upstreamPlugins.length}`);

  // Validate upstream
  const valid = upstreamPlugins.filter(p => p.name && p.source);
  const invalid = upstreamPlugins.length - valid.length;
  if (invalid > 0) {
    const pct = (invalid / upstreamPlugins.length) * 100;
    console.warn(`  WARNING: ${invalid} entries missing name or source (${pct.toFixed(1)}%)`);
    if (pct > 20) {
      console.error("  ABORT: >20% invalid entries — upstream schema may have changed");
      process.exit(1);
    }
  }

  // Map upstream entries, skipping any that conflict with local IDs
  const upstreamEntries = [];
  const skipped = [];
  for (const upstream of valid) {
    if (localIds.has(upstream.name)) {
      skipped.push(upstream.name);
      continue;
    }
    // Auto-stamp sourceMarketplace for upstream imports
    upstreamEntries.push(mapEntry(upstream, "anthropic", ownerName, false));
  }
  if (skipped.length > 0) {
    console.log(`Skipped (conflicts with local IDs): ${skipped.join(", ")}`);
  }

  // Deduplicate upstream by id
  const seen = new Set();
  const dedupedUpstream = [];
  for (const entry of upstreamEntries) {
    if (seen.has(entry.id)) {
      console.warn(`  Duplicate upstream id "${entry.id}" — keeping first`);
      continue;
    }
    seen.add(entry.id);
    dedupedUpstream.push(entry);
  }

  // --- Diff against previous index ---
  const allNewIds = new Set([...localIds, ...dedupedUpstream.map(e => e.id)]);
  const allNew = [...localEntries, ...dedupedUpstream];
  const newById = new Map(allNew.map(e => [e.id, e]));

  let added = 0, updated = 0, unchanged = 0, deprecated = 0;

  // Process new/updated entries — carry forward version and publishedAt when unchanged
  const finalEntries = [];

  for (const entry of allNew) {
    const prev = previousById.get(entry.id);
    if (!prev) {
      // New entry — use defaults (1.0.0, today)
      added++;
      finalEntries.push(entry);
    } else if (hasChanges(prev, entry)) {
      // Changed — bump version, update publishedAt
      entry.version = bumpPatch(prev.version);
      entry.publishedAt = new Date().toISOString().split("T")[0] + "T00:00:00Z";
      updated++;
      finalEntries.push(entry);
    } else {
      // Unchanged — preserve version and publishedAt from previous
      entry.version = prev.version;
      entry.publishedAt = prev.publishedAt;
      // Also preserve deprecated flag if it was set
      if (prev.deprecated) {
        entry.deprecated = prev.deprecated;
        entry.deprecatedAt = prev.deprecatedAt;
      }
      unchanged++;
      finalEntries.push(entry);
    }
  }

  // Detect removed entries — keep them but flag as deprecated
  for (const prev of previousIndex) {
    if (!allNewIds.has(prev.id) && !prev.deprecated) {
      // Entry was in previous index but not in either source — mark deprecated
      const deprecatedEntry = { ...prev, deprecated: true, deprecatedAt: new Date().toISOString().split("T")[0] };
      deprecated++;
      finalEntries.push(deprecatedEntry);
      console.log(`  DEPRECATED: ${prev.id} (no longer in upstream)`);
    } else if (!allNewIds.has(prev.id) && prev.deprecated) {
      // Already deprecated — carry forward as-is
      finalEntries.push(prev);
    }
  }

  // Sort: DestinCode first (alphabetical), then anthropic (alphabetical), then deprecated
  finalEntries.sort((a, b) => {
    // Deprecated always last
    if (a.deprecated && !b.deprecated) return 1;
    if (!a.deprecated && b.deprecated) return -1;
    // DestinCode before anthropic
    const aSource = a.sourceMarketplace || "destinclaude";
    const bSource = b.sourceMarketplace || "destinclaude";
    if (aSource !== bSource) {
      if (aSource === "destinclaude") return -1;
      if (bSource === "destinclaude") return 1;
      return aSource.localeCompare(bSource);
    }
    return a.id.localeCompare(b.id);
  });

  // --- Validation ---
  const errors = [];
  const allIds = new Set();
  for (const entry of finalEntries) {
    if (!entry.id) errors.push("Entry missing id");
    if (!entry.type) errors.push(`${entry.id}: missing type`);
    if (!entry.displayName) errors.push(`${entry.id}: missing displayName`);
    if (!entry.description) errors.push(`${entry.id}: missing description`);
    if (allIds.has(entry.id)) errors.push(`${entry.id}: duplicate id`);
    allIds.add(entry.id);
  }
  if (errors.length > 0) {
    console.warn("Validation warnings:");
    errors.forEach(e => console.warn(`  - ${e}`));
  }

  // --- Write index with version wrapper ---
  const output = {
    version: new Date().toISOString(),
    generatedBy: "sync.js",
    entries: finalEntries,
  };

  // Check if output actually changed (idempotency)
  let prevContent = null;
  if (fs.existsSync(SKILLS_INDEX_PATH)) {
    prevContent = fs.readFileSync(SKILLS_INDEX_PATH, "utf8");
  }
  const newContent = JSON.stringify(output, null, 2) + "\n";

  // Compare entries only (ignore version timestamp) for idempotency check
  const prevEntries = prevContent ? JSON.stringify(JSON.parse(prevContent).entries) : null;
  const newEntries = JSON.stringify(output.entries);
  const isIdentical = prevEntries === newEntries;

  if (isIdentical) {
    console.log("\nNo changes detected — index is up to date.");
    // Don't write (preserves the previous version timestamp)
  } else {
    fs.writeFileSync(SKILLS_INDEX_PATH, newContent);
    console.log(`\nWritten ${finalEntries.length} entries to skills/index.json`);
  }

  // Summary
  console.log(`  Added: ${added}, Updated: ${updated}, Unchanged: ${unchanged}, Deprecated: ${deprecated}`);
  const bySource = {};
  for (const e of finalEntries) {
    const src = e.sourceMarketplace || "destinclaude";
    bySource[src] = (bySource[src] || 0) + 1;
  }
  console.log("  By source:", JSON.stringify(bySource));
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
