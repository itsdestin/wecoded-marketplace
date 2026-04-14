// extract-components.js — inventory a plugin's skills/hooks/commands/agents/mcp.
//
// Two entry points:
//   extractLocalComponents(pluginDir)       — for sourceType: "local"
//   extractRemoteComponents(entry, cache)   — for sourceType: "url" | "git-subdir"
//
// V1 policy: names-only, derived from path conventions. No frontmatter/content
// fetches. Rationale: 1 API call per remote plugin, ~135 total for Anthropic,
// well under the 5000/hr authenticated rate limit.
//
// Failure handling: per-plugin try/catch. On any failure, returns
// { components: null, componentsError: "<class>" } so one bad plugin doesn't
// abort the whole sync. The caller is expected to propagate these fields onto
// the index entry and write them to sync-report.json.
//
// Rate limit: if a 403 with X-RateLimit-Remaining: 0 is hit, throw
// RateLimitError — sync.js aborts rather than partial-writing the index.

const fs = require("fs");
const path = require("path");
const https = require("https");

class RateLimitError extends Error {
  constructor(resetSeconds) {
    super(`GitHub rate limit exhausted; resets in ${resetSeconds}s`);
    this.name = "RateLimitError";
  }
}

// ---------------------------------------------------------------------------
// Path-convention parsing — shared by local + remote
// ---------------------------------------------------------------------------

// Given a flat list of repo-relative paths (optionally prefixed with subdir/),
// classify into components. Strips the subdir prefix if provided.
function classifyPaths(paths, subdir) {
  const prefix = subdir ? subdir.replace(/\/?$/, "/") : "";
  const rel = (p) => (prefix && p.startsWith(prefix) ? p.slice(prefix.length) : p);

  const skills = new Set();
  const hooks = new Set();
  const commands = new Set();
  const agents = new Set();
  const mcpServers = new Set();
  let hasHooksManifest = false;
  let hasMcpConfig = false;

  for (const raw of paths) {
    // If a subdir was requested but this path isn't under it, skip. Keeps
    // monorepo-subdir plugins from picking up sibling components.
    if (prefix && !raw.startsWith(prefix)) continue;
    const p = rel(raw);

    // skills/<name>/SKILL.md  →  <name>
    let m = p.match(/^skills\/([^\/]+)\/SKILL\.md$/i);
    if (m) { skills.add(m[1]); continue; }

    // hooks/hooks-manifest.json  →  flag presence (can't enumerate without a fetch)
    if (/^hooks\/hooks-manifest\.json$/.test(p)) { hasHooksManifest = true; continue; }

    // hooks/<name>.sh  →  <name>
    m = p.match(/^hooks\/([^\/]+)\.sh$/);
    if (m) { hooks.add(m[1]); continue; }

    // commands/<name>.md  →  /<name>
    m = p.match(/^commands\/([^\/]+)\.md$/);
    if (m) { commands.add(m[1]); continue; }

    // agents/<name>.md  →  <name>
    m = p.match(/^agents\/([^\/]+)\.md$/);
    if (m) { agents.add(m[1]); continue; }

    // .mcp.json or mcp/servers.json  →  flag presence
    if (/^\.mcp\.json$/.test(p) || /^mcp\/servers\.json$/.test(p)) {
      hasMcpConfig = true;
    }
  }

  return {
    skills: [...skills].sort(),
    hooks: [...hooks].sort(),
    commands: [...commands].sort(),
    agents: [...agents].sort(),
    mcpServers: [...mcpServers].sort(),
    hasHooksManifest,
    hasMcpConfig,
  };
}

// ---------------------------------------------------------------------------
// Local filesystem walk
// ---------------------------------------------------------------------------

function walkFs(root) {
  const out = [];
  (function visit(dir, rel) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      if (e.name === ".git" || e.name === "node_modules") continue;
      const full = path.join(dir, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) visit(full, r);
      else out.push(r);
    }
  })(root, "");
  return out;
}

function extractLocalComponents(pluginDir) {
  try {
    if (!fs.existsSync(pluginDir)) {
      return { components: null, componentsError: "dir-missing" };
    }
    const paths = walkFs(pluginDir);
    return { components: classifyPaths(paths, null) };
  } catch (err) {
    return { components: null, componentsError: `local-walk: ${err.message}` };
  }
}

// ---------------------------------------------------------------------------
// Remote (GitHub Tree API) walk
// ---------------------------------------------------------------------------

// Parse owner/repo from a git URL.
// Accepts: https://github.com/owner/repo.git, https://github.com/owner/repo, owner/repo
function parseRepo(gitUrl) {
  if (!gitUrl) return null;
  const trimmed = gitUrl.replace(/\.git$/, "").replace(/\/$/, "");
  const m = trimmed.match(/github\.com[:\/]([^\/]+)\/([^\/]+)$/) ||
            trimmed.match(/^([^\/]+)\/([^\/]+)$/);
  return m ? { owner: m[1], repo: m[2] } : null;
}

function githubGet(pathSegment, redirects = 0) {
  return new Promise((resolve, reject) => {
    const headers = {
      "User-Agent": "destincode-marketplace-extract",
      Accept: "application/vnd.github+json",
    };
    if (process.env.GITHUB_TOKEN) {
      headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    }
    const opts = {
      hostname: "api.github.com",
      path: pathSegment,
      method: "GET",
      headers,
    };
    const req = https.request(opts, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        // Follow GH redirects (301/302) — commonly a repo rename or default-
        // branch alias. Cap at 3 hops to avoid loops.
        if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location && redirects < 3) {
          const next = res.headers.location.replace(/^https:\/\/api\.github\.com/, "");
          githubGet(next, redirects + 1).then(resolve, reject);
          return;
        }
        // Rate-limit detection: GitHub returns 403 with X-RateLimit-Remaining: 0.
        if (res.statusCode === 403 && res.headers["x-ratelimit-remaining"] === "0") {
          const reset = parseInt(res.headers["x-ratelimit-reset"] || "0", 10);
          const secs = reset ? Math.max(0, reset - Math.floor(Date.now() / 1000)) : 0;
          reject(new RateLimitError(secs));
          return;
        }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: data,
        });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

// Fetch the full recursive tree for a commit/tree SHA or ref.
async function fetchTree(owner, repo, sha) {
  const res = await githubGet(`/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`);
  if (res.status === 404) {
    const err = new Error("sha-missing");
    err.code = "sha-missing";
    throw err;
  }
  if (res.status !== 200) {
    const err = new Error(`http-${res.status}`);
    err.code = `http-${res.status}`;
    throw err;
  }
  const json = JSON.parse(res.body);
  return { tree: json.tree || [], truncated: json.truncated === true };
}

// Fall back to resolving a branch/ref to a commit SHA, when `sourceSha` is absent.
async function resolveRef(owner, repo, ref) {
  const res = await githubGet(`/repos/${owner}/${repo}/commits/${encodeURIComponent(ref)}`);
  if (res.status !== 200) {
    const err = new Error(`ref-resolve-${res.status}`);
    err.code = `ref-resolve-${res.status}`;
    throw err;
  }
  const json = JSON.parse(res.body);
  return json.sha;
}

// Main remote extractor. `cache` is a plain object shared across a sync run;
// extractRemoteComponents stores two kinds of entries in it:
//   __tree:<owner>/<repo>@<sha>    → full tree fetch (shared across subdirs)
//   __ref:<owner>/<repo>@<ref>     → resolved commit SHA for a ref
//   <owner>/<repo>@<sha>#<subdir>  → per-subdir classified result
// Keeping all three in one cache is fine — the prefixes are unambiguous.
async function extractRemoteComponents(entry, cache) {
  const repo = parseRepo(entry.sourceRef);
  if (!repo) return { components: null, componentsError: "unparseable-source" };

  try {
    // Resolve SHA — prefer the pinned one from upstream, fall back to ref.
    let sha = entry.sourceSha;
    if (!sha) {
      const ref = entry.sourceGitRef || "HEAD";
      const refKey = `__ref:${repo.owner}/${repo.repo}@${ref}`;
      if (cache && cache[refKey]) {
        sha = cache[refKey];
      } else {
        sha = await resolveRef(repo.owner, repo.repo, ref);
        if (cache) cache[refKey] = sha;
      }
    }

    const cacheKey = `${repo.owner}/${repo.repo}@${sha}#${entry.sourceSubdir || ""}`;
    if (cache && cache[cacheKey]) return cache[cacheKey];

    // Tree cache — shared across all subdirs of the same repo@sha. Critical
    // for upstreams like Anthropic's where 130+ plugins live in one repo;
    // without this we'd fetch the same tree 130 times.
    const treeKey = `__tree:${repo.owner}/${repo.repo}@${sha}`;
    let tree, truncated;
    if (cache && cache[treeKey]) {
      ({ tree, truncated } = cache[treeKey]);
    } else {
      ({ tree, truncated } = await fetchTree(repo.owner, repo.repo, sha));
      if (cache) cache[treeKey] = { tree, truncated };
    }

    if (truncated) {
      const result = { components: null, componentsError: "truncated" };
      if (cache) cache[cacheKey] = result;
      return result;
    }

    const paths = tree.filter((n) => n.type === "blob").map((n) => n.path);
    const result = { components: classifyPaths(paths, entry.sourceSubdir) };
    if (cache) cache[cacheKey] = result;
    return result;
  } catch (err) {
    if (err instanceof RateLimitError) throw err; // abort whole run
    return { components: null, componentsError: err.code || err.message };
  }
}

module.exports = {
  extractLocalComponents,
  extractRemoteComponents,
  classifyPaths, // exported for unit testing
  parseRepo,     // exported for unit testing
  RateLimitError,
};
