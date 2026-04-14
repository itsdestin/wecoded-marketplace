-- Auth hardening: separate CSRF state from user_code, defer session issuance
-- until poll so the raw session token never sits in the DB.
--
-- Why: previously `user_code` doubled as the GitHub OAuth `state` parameter,
-- and the callback handler stashed the raw session token in
-- `session_token_hash` (misnamed column) until the poll endpoint retrieved it.
-- That design had two issues:
--   1. Login-CSRF: an attacker could trick a victim's browser into completing
--      the callback for an attacker-initiated flow, because nothing bound the
--      `state` value to the browser that started it.
--   2. If the poll never happened (crash, network loss), the raw session
--      token lingered in D1 until the row's 15-min TTL expired.
--
-- Fix: add `csrf_state` (opaque, not shown to the user, verified against an
-- HttpOnly cookie on callback) and `authorized_user_id` (poll issues the
-- session after claiming the row atomically — no raw token at rest).

ALTER TABLE device_codes ADD COLUMN csrf_state TEXT;
ALTER TABLE device_codes ADD COLUMN authorized_user_id TEXT;

CREATE INDEX idx_device_codes_csrf_state ON device_codes(csrf_state);
