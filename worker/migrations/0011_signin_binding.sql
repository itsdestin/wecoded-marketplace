-- Sign-in hardening (card #55).
--
-- WHY loopback_port / loopback_hash: a sign-in link on its own proves nothing about
-- WHO started it, so an attacker could start a sign-in, send the link to someone
-- else, and collect the session that person approved. A new app now tells the
-- server which local port it is listening on; after GitHub approves, the server
-- sends the approving browser back to http://127.0.0.1:<port>/ carrying a one-time
-- secret, and only the app that receives it can finish the sign-in. Only the hash
-- of that secret is stored. Rows from older apps leave both columns NULL and keep
-- working exactly as before.
--
-- WHY ip_bucket: a short-lived, keyed and day-salted fingerprint of the caller used
-- only to cap how many sign-ins one network can start (it works on every hostname,
-- unlike the cache-based limiter). It is not the IP and is deleted with the row.
ALTER TABLE device_codes ADD COLUMN loopback_port INTEGER;
ALTER TABLE device_codes ADD COLUMN loopback_hash TEXT;
ALTER TABLE device_codes ADD COLUMN ip_bucket TEXT;
CREATE INDEX idx_device_codes_ip_bucket ON device_codes(ip_bucket, created_at);
