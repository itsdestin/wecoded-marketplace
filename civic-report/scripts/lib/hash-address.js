import { createHash } from "node:crypto";

// Used for filename-safe address fingerprint. WHY: we render the address in
// the report body but keep the filename opaque so a shared file doesn't leak
// the exact address in the path.
export function hashAddress(raw) {
  const normalized = raw.trim().toLowerCase().replace(/\s+/g, " ");
  return createHash("sha256").update(normalized).digest("hex").slice(0, 6);
}
