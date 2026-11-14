// Relay membership check: what the relay computes to decide "is this device allowed in this room".
//
// The relay holds ONLY public information here: public verification keys and opaque ids.
// It imports nothing that can sign, seal or open (threat model Y-1: a static check that the
// Worker never touches key material); crypto.subtle.verify and digest are the only calls.
//
// Formats are fixed by T5-crypto-and-pairing.md (C2, C5, C9):
//   deviceId = first 16 bytes of SHA-256("youcoded-mesh/v1/device-id\0" || signKey)
//   room     = SHA-256("youcoded-mesh/v1/room\0" || first device's signKey)   (self-certifying)
//   signed   = "youcoded-mesh/v1/relay-auth\0" || canonicalCBOR{ aud, room, nonce, dev }

const L = "youcoded-mesh/v1/";
const enc = new TextEncoder();

export function hexToBytes(h: string): Uint8Array {
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}
export function bytesToHex(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}
function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
async function sha256(...parts: Uint8Array[]): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", concat(...parts)));
}

/** The room name a first device's key must produce. WHY the relay checks it: it makes a room
 *  self-certifying, so nobody can claim a room name without holding the key that names it. */
export async function roomIdFor(signKeyHex: string): Promise<string> {
  return bytesToHex(await sha256(enc.encode(L + "room\0"), hexToBytes(signKeyHex)));
}
export async function deviceIdFor(signKeyHex: string): Promise<string> {
  return bytesToHex((await sha256(enc.encode(L + "device-id\0"), hexToBytes(signKeyHex))).subarray(0, 16));
}

// ---- Minimal deterministic CBOR (RFC 8949 4.2.1) for exactly the challenge message: a map of
// text keys to text or byte-string values. Not a general encoder on purpose; the app's full
// restricted-CBOR encoder (T5 C5) is the reference and the test pins this against its output.
function head(major: number, n: number): Uint8Array {
  if (n < 24) return Uint8Array.of((major << 5) | n);
  if (n < 0x100) return Uint8Array.of((major << 5) | 24, n);
  return Uint8Array.of((major << 5) | 25, (n >> 8) & 0xff, n & 0xff); // lengths here are far below 65536
}
function cborItem(v: string | Uint8Array): Uint8Array {
  if (typeof v === "string") { const b = enc.encode(v); return concat(head(3, b.length), b); }
  return concat(head(2, v.length), v);
}
export function relayAuthMessage(aud: string, roomHex: string, nonceHex: string, devHex: string): Uint8Array {
  const entries: Array<[Uint8Array, Uint8Array]> = [
    [cborItem("aud"), cborItem(aud)],
    [cborItem("room"), cborItem(hexToBytes(roomHex))],
    [cborItem("nonce"), cborItem(hexToBytes(nonceHex))],
    [cborItem("dev"), cborItem(hexToBytes(devHex))],
  ];
  // Map keys sorted bytewise on their encoded form (the deterministic-encoding rule).
  entries.sort((a, b) => {
    const n = Math.min(a[0].length, b[0].length);
    for (let i = 0; i < n; i++) { const d = (a[0][i] as number) - (b[0][i] as number); if (d) return d; }
    return a[0].length - b[0].length;
  });
  return concat(enc.encode(L + "relay-auth\0"), head(5, entries.length), ...entries.flat());
}

// ---- Signed roster statement (review finding 8). A current member signs a small statement that a device was
// added or removed. WHY a statement and not the app's whole roster entry: an `add` entry carries the new device's
// NAME and platform, and the relay must never learn those (it sees opaque ids and public keys only; the pairing rig
// asserts it). The statement names the entry by its id, so it is bound to one real roster entry, and carries exactly
// what the relay's rules need: who signs, who is added/removed, the entry's `seen` ids (its stated ancestry).
//   signed = LABEL+"relay-roster\0" || canonicalCBOR{ kind, room, signer, target, targetKey|null, entry, seen[], at }
// The app builds the same bytes with its full CBOR encoder; known-answer vectors (test/mesh-roster-vectors.json here,
// tests/mesh/mesh-roster-vectors.json there, kept byte-identical by a drift test) pin the two together.
export interface RosterStatement { kind: "add" | "remove" | "rename"; room: string; signer: string; target: string; targetKey: string | null; entry: string; seen: string[]; at: number }
function uintItem(n: number): Uint8Array {
  // Shortest form, as the deterministic encoding requires. `at` is a millisecond clock: below 2^53.
  if (n < 24) return Uint8Array.of(n);
  if (n < 0x100) return Uint8Array.of(24, n);
  if (n < 0x10000) return Uint8Array.of(25, n >> 8, n & 0xff);
  if (n < 0x100000000) return Uint8Array.of(26, (n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
  const out = new Uint8Array(9);
  out[0] = 27;
  new DataView(out.buffer).setBigUint64(1, BigInt(n));
  return out;
}
export function rosterStatementMessage(s: RosterStatement): Uint8Array {
  const entries: Array<[Uint8Array, Uint8Array]> = [
    [cborItem("kind"), cborItem(s.kind)],
    [cborItem("room"), cborItem(hexToBytes(s.room))],
    [cborItem("signer"), cborItem(hexToBytes(s.signer))],
    [cborItem("target"), cborItem(hexToBytes(s.target))],
    [cborItem("targetKey"), s.targetKey === null ? Uint8Array.of(0xf6) : cborItem(hexToBytes(s.targetKey))],
    [cborItem("entry"), cborItem(hexToBytes(s.entry))],
    [cborItem("seen"), concat(head(4, s.seen.length), ...s.seen.map((x) => cborItem(hexToBytes(x))))],
    [cborItem("at"), uintItem(s.at)],
  ];
  entries.sort((a, b) => {
    const n = Math.min(a[0].length, b[0].length);
    for (let i = 0; i < n; i++) { const d = (a[0][i] as number) - (b[0][i] as number); if (d) return d; }
    return a[0].length - b[0].length;
  });
  return concat(enc.encode(L + "relay-roster\0"), head(5, entries.length), ...entries.flat());
}

/** Ed25519 verify that can never throw: a malformed key or signature is simply "no". */
export async function verifyEd25519(pubKeyHex: string, message: Uint8Array, sigHex: string): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey("raw", hexToBytes(pubKeyHex), { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify({ name: "Ed25519" }, key, hexToBytes(sigHex), message);
  } catch {
    return false;
  }
}

export function randomHex(bytes: number): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(bytes)));
}

// ---- Is this 32-byte string a real Ed25519 public key? (review finding 13)
// WHY by hand: WebCrypto's raw import accepts ANY 32 bytes without checking they are a point on the curve (measured
// in the test runtime), so a garbage "key" could take one of the 16 roster slots and never be able to sign in.
// RFC 8032 5.1.3: y (the low 255 bits) must be below p, and x^2 = (y^2-1)/(d*y^2+1) must have a square root mod p.
const P = (1n << 255n) - 19n;
const D = (P - ((121665n * modPow(121666n, P - 2n, P)) % P)) % P; // d = -121665/121666
function modPow(b: bigint, e: bigint, m: bigint): bigint {
  let r = 1n; b %= m;
  while (e > 0n) { if (e & 1n) r = (r * b) % m; b = (b * b) % m; e >>= 1n; }
  return r;
}
export async function isEd25519Point(keyHex: string): Promise<boolean> {
  if (!/^[0-9a-f]{64}$/.test(keyHex)) return false;
  const bytes = hexToBytes(keyHex);
  const signBit = (bytes[31]! & 0x80) !== 0;
  bytes[31] = bytes[31]! & 0x7f;
  let y = 0n;
  for (let i = 31; i >= 0; i--) y = (y << 8n) | BigInt(bytes[i]!);
  if (y >= P) return false;
  const y2 = (y * y) % P;
  const u = (y2 - 1n + P) % P;
  const v = (D * y2 + 1n) % P;
  const x2 = (u * modPow(v, P - 2n, P)) % P;
  if (x2 === 0n) return !signBit; // x = 0 with the sign bit set is not a valid encoding
  return modPow(x2, (P - 1n) / 2n, P) === 1n; // Euler's criterion: a square exists
}
