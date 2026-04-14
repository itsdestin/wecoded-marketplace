// schema.js — single source of truth for marketplace entry enum validation.
//
// Used by:
//   - sync.js (normalizes tags, validates overrides at write time)
//   - CI (.github/workflows/validate-plugin-pr.yml rejects out-of-enum values)
//   - Future: client-side filter chips derive from ALLOWED_LIFE_AREAS.

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

// Soft tags — free-form-ish topical labels. Kept intentionally small; if a tag
// would only apply to one or two plugins, use tagline text instead.
const ALLOWED_TAGS = [
  // Content kinds
  "skill", "theme", "plugin", "prompt", "agent", "hook", "command", "mcp",
  // Topical
  "productivity", "writing", "research", "code-review", "debugging", "testing",
  "docs", "git", "shell", "data", "design", "learning", "planning",
  "communication", "journal", "reference", "automation", "ai", "personal",
  // Meta
  "new", "popular", "featured", "beta",
];

// Life areas drive the "Vibe" chip row in the new marketplace UI.
// Kept to seven — more than that and the chips crowd the filter bar.
const ALLOWED_LIFE_AREAS = [
  "school", "work", "creative", "health", "personal", "finance", "home",
];

// Audience is a coarse dev/non-dev hint. Used by the featured rails to pick
// defaults (non-devs shouldn't see a "debugging" rail on first open).
const ALLOWED_AUDIENCE = ["general", "developer"];

// Tag aliases — normalize common variants to the canonical enum value.
// Applied at sync-write time; never stored in overrides.
const TAG_ALIASES = {
  students: "school",
  student: "school",
  education: "school",
  productive: "productivity",
  "productivity-tools": "productivity",
  dev: "plugin",
  developer: "plugin",
  coding: "code-review",
  debug: "debugging",
  test: "testing",
  documentation: "docs",
  automate: "automation",
  note: "journal",
  notes: "journal",
};

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

function normalizeTag(tag) {
  if (typeof tag !== "string") return null;
  const lower = tag.toLowerCase().trim();
  if (!lower) return null;
  const aliased = TAG_ALIASES[lower] || lower;
  return ALLOWED_TAGS.includes(aliased) ? aliased : null;
}

// Normalize an array of tags; drops unknown values silently.
// Returns a deduped array in original order.
function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  const seen = new Set();
  const out = [];
  for (const t of tags) {
    const norm = normalizeTag(t);
    if (norm && !seen.has(norm)) {
      seen.add(norm);
      out.push(norm);
    }
  }
  return out;
}

// Validate an entry's enum-bearing fields. Returns array of error strings; empty = OK.
// Used by CI to hard-fail on invalid values (unlike sync.js which silently drops).
function validateEnums(entry) {
  const errors = [];
  if (Array.isArray(entry.tags)) {
    for (const tag of entry.tags) {
      const lower = typeof tag === "string" ? tag.toLowerCase().trim() : "";
      const aliased = TAG_ALIASES[lower] || lower;
      if (!ALLOWED_TAGS.includes(aliased)) {
        errors.push(`tag "${tag}" not in ALLOWED_TAGS`);
      }
    }
  }
  if (Array.isArray(entry.lifeArea)) {
    for (const area of entry.lifeArea) {
      if (!ALLOWED_LIFE_AREAS.includes(area)) {
        errors.push(`lifeArea "${area}" not in ALLOWED_LIFE_AREAS`);
      }
    }
  }
  if (entry.audience != null && !ALLOWED_AUDIENCE.includes(entry.audience)) {
    errors.push(`audience "${entry.audience}" not in ALLOWED_AUDIENCE`);
  }
  return errors;
}

module.exports = {
  ALLOWED_TAGS,
  ALLOWED_LIFE_AREAS,
  ALLOWED_AUDIENCE,
  TAG_ALIASES,
  normalizeTag,
  normalizeTags,
  validateEnums,
};
