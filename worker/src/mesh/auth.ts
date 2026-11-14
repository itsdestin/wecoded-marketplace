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
