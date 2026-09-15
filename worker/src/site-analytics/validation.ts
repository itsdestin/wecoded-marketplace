import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { HonoEnv } from '../types';

export const DAY = 86400;
export const MAX_BODY = 4096;
export const dayOf = (time: number) => new Date(time * 1000).toISOString().slice(0, 10);
export const fail = (status: 400 | 403 | 404 | 410 | 413 | 429 | 500 | 503, code: string) => new HTTPException(status, { message: code });
export type Downloads = { Windows: number; macOS: number; Linux: number; Android: number };

export function validDay(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}
export function labels(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== 'string' || value !== value.trim() || !value.length || value.length > 160 || new TextEncoder().encode(value).length > 640) return false;
  if (['(untagged)', 'Direct / unknown', 'Other referring sites'].includes(value)) return false;
  // WHY Unicode mode: a valid emoji pair is one scalar; lone UTF-16 surrogates are rejected.
  return !/[\x00-\x1f\x7f-\x9f\ud800-\udfff]/u.test(value);
}
export function domain(value: unknown): value is string {
  if (value === '') return true;
  if (typeof value !== 'string' || value.length > 253 || value !== value.toLowerCase()) return false;
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/.test(value)) return false;
  return !/(?:^|\.)(?:localhost|local|internal|test|invalid|home|lan)$/.test(value);
}
export function counters(value: unknown): Downloads | null {
  if (!value || typeof value !== 'object' || Object.keys(value).sort().join(',') !== 'Android,Linux,Windows,macOS') return null;
  const d = value as Downloads;
  return Object.values(d).every(n => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 && n <= 100)
    && Object.values(d).reduce((a, b) => a + b, 0) <= 100 ? d : null;
}
export async function parseFields(c: Context<HonoEnv>, fields: readonly string[]): Promise<Record<string, unknown>> {
  if (c.req.header('Content-Type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') throw fail(400, 'invalid_request');
  const reader = c.req.raw.body?.getReader();
  if (!reader) throw fail(400, 'invalid_request');
  let size = 0;
  const chunks: Uint8Array[] = [];
  // WHY stream rather than trust Content-Length: chunked requests can omit or lie about their size.
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_BODY) { await reader.cancel(); throw fail(413, 'too_large'); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  let input: unknown;
  try { input = JSON.parse(new TextDecoder().decode(await new Blob(chunks).arrayBuffer())); }
  catch { throw fail(400, 'invalid_request'); }
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).sort().join(',') !== [...fields].sort().join(',')) throw fail(400, 'invalid_request');
  return input as Record<string, unknown>;
}
