> **Source:** Brainstormed in `crunchtronics-tutor/docs/superpowers/specs/2026-04-26-spotify-services-plugin-design.md` on 2026-04-26. This file is the canonical design from then on — corrections applied per the implementation plan at `plan.md`. Do not modify the tutor copy; treat it as a historical artifact.

# spotify-services Marketplace Plugin — Design Spec

- **Date:** 2026-04-26
- **Status:** Drafted (via brainstorm in tutor repo, awaiting user review)
- **Lives outside this repo:** the plugin's eventual home is the WeCoded marketplace (alongside `google-services`). This spec lives in the tutor repo for now because the brainstorm originated here; it should be copied to `spotify-services/docs/design.md` once the plugin's directory is initialized.
- **Related tutor-side spec:** `docs/superpowers/specs/subsystems/05-spotify-integration.md`
- **Related master spec sections (tutor's perspective):** §3.1 (Spotify deprecation context), §5.1 #5 (the subsystem the plugin replaces the bulk of), §6 (data flow), §7.1 (`taste/playlists.json` shape — the plugin's main output for the tutor)

## 1. Purpose

Build a public Claude Code marketplace plugin, `spotify-services`, that gives any Claude Code project a unified, well-documented way to talk to Spotify. The plugin replaces what would otherwise be project-specific Spotify code (originally Subsystem #5 of the Crunchtronics Tutor) with a reusable component.

The plugin combines:

- The Spotify Web API (search, library, playlists, queue, playback, etc.) for everything that requires authentication.
- Native local control of the Spotify desktop app on macOS and Windows, for transport operations that don't need OAuth, Premium, or rate-limit budgets.

It is modeled after the `google-services` plugin in the same marketplace.

## 2. Why this exists / decision history

Brainstorm on 2026-04-26 established the following, in order:

1. **Plugin shape and home:** public WeCoded marketplace, sibling of `google-services`. End users register their own Spotify Developer apps; no hardcoded credentials.
2. **Surface area target:** full breadth — read, library, playlists, playback, queue, plus local desktop control. Not minimum viable.
3. **Implementation pattern survey:** `google-services` works by *teaching* Claude how to use an existing tool (the `gws` CLI binary). For Spotify, no equivalent official binary exists. The closest analog is an MCP server.
4. **MCP server survey:** evaluated `varunneal/spotify-mcp` (Python+spotipy), `marcelmarais/spotify-mcp-server` (TS), and `Carrieukie/spotify-mcp-server` (Kotlin). All three are Web-API-only; none control the local desktop app. Capability coverage varies; none of them ship a one-shot full-library export (the tutor's actual need).
5. **Decision:** build our own MCP server, splicing together capabilities from the surveyed servers and adding a native local-control layer. Single repo for both the plugin and the server (no `gws`-style split, because the server has no plausible non-plugin consumer).

References:
- Spotify post-Feb-2026 API changes: https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide
- Spotify post-Nov-2025 OAuth migration: https://developer.spotify.com/blog/2025-10-14-reminder-oauth-migration-27-nov-2025
- macOS AppleScript control: native to Spotify's desktop app, no auth needed.
- Windows SMTC control: `GlobalSystemMediaTransportControlsSessionManager` via `pywinrt` Python bindings.

## 3. Constraints and assumptions

1. **Spotify API surface (post-Feb-2026)** — a large set of endpoints were permanently removed in February 2026. See the full removal list at https://developer.spotify.com/documentation/web-api/references/changes/february-2026. The plugin must not expose tools that wrap any of these; doing so would ship broken capabilities. Removed in **Feb 2026**:
   - All 7 batch GET endpoints: `/tracks`, `/albums`, `/artists`, `/episodes`, `/shows`, `/audiobooks`, `/chapters`
   - User routes: `GET /users/{id}`, `GET /users/{id}/playlists`, `POST /users/{id}/playlists`
   - Browse routes: `/browse/new-releases`, `/browse/categories`, `/browse/categories/{id}`
   - `/markets`
   - `/artists/{id}/top-tracks`
   - All entity-typed library save/remove/get endpoints (`PUT/DELETE/GET /me/tracks`, `/me/albums`, `/me/episodes`, `/me/shows`, `/me/audiobooks`, `/me/following`, `/playlists/{id}/followers`) — replaced by generic `PUT/DELETE/GET /me/library` taking Spotify URIs
   - `/playlists/{id}/tracks` renamed to `/playlists/{id}/items`
   - Search `limit` capped at 10 (was 50), default 5 (was 20)
   - Field removals: `popularity`, `available_markets`, `linked_from`, `external_ids`, user `country`/`email`/`product`, album `label`, artist `followers`

   Removed in **Nov 2024** (still applicable): `audio-features`, `audio-analysis`, `related-artists`, `recommendations`.

2. **OAuth flow** — Authorization Code with PKCE only. Implicit grant and HTTP redirect URIs were retired Nov 27, 2025.

3. **Premium-tier requirement (whole plugin)** — Spotify's Feb 2026 platform-security update requires the authorizing user to have Premium for any app not granted Extended Quota. The plugin therefore assumes Premium for all users; setup surfaces this prominently. Apps in Dev Mode are capped at 5 authorized users.

4. **Cross-platform desktop control** — supported: macOS (AppleScript) and Windows (SMTC). Linux (MPRIS) and Android both out of scope for v1. Android is deferred specifically because Termux ships Python 3 but no `pip`/`uv` — vendoring the dependency tree is a v2 scope.

5. **End-user Spotify Developer app registration** — every user registers their own app, copies their own Client ID, runs OAuth against their own account. No hardcoded credentials in the plugin.

6. **Dependencies** — Python 3.12, `uv` for environment management, `spotipy` for Web API, `pywinrt` (`winrt-Windows.Media.Control`, Windows-only optional) for SMTC. macOS uses no extra deps (AppleScript via subprocess `osascript`).

7. **Concurrency / rate limits** — respect Spotify's `Retry-After` header on 429 responses. No deliberate concurrency in v1; calls are sequential. Pagination is opt-in (see `--all` flag below).

## 4. Architecture

### 4.1 Single Python MCP server, split backends, smart-routed tools

One process: `spotify-mcp-server`, Python 3.12, installed at `~/.spotify-services/server/` via `uv venv` + `uv pip install` from in-tree source.

The server exposes MCP tools that route internally to one of three places:

- **Web API backend** — covers everything that needs auth: search, library, playlists, queue, playback, user profile.
- **Local backend (macOS)** — invokes `osascript` subprocess to talk to Spotify's AppleScript dictionary. Covers transport, current-track, seek, volume, app launch/quit.
- **Local backend (Windows)** — invokes `pywinrt` (`winrt-Windows.Media.Control`) to read/control SMTC. Covers transport and current-track. Does *not* expose seek or volume (SMTC doesn't include them).

A small platform router decides at startup which local backend (if any) is available. If neither is available (e.g., headless Linux), local tools return a structured "local backend unavailable" error.

### 4.2 Smart-routing convention

Tools that exist in both backends (transport, now-playing) are not exposed twice; they're exposed as a single tool whose handler chooses the backend. The default routing rules:

- **Transport (`play`, `pause`, `next`, `previous`):** prefer local backend if the desktop app is running; fall back to Web API + active-device transfer.
- **`now_playing`:** read from local backend (instant, no API call); enrich with Web API metadata if a token is available and the user wants the enrichment (controlled by a tool argument, default `enrich=false`).

For users who want explicit control, the server also exposes raw backend tools as `local.*` and `webapi.*` namespaces. Most callers should use the smart-routed tools; the raw backends exist for cases where Claude needs to bypass routing.

### 4.3 Plugin layer (skill wrappers + setup)

The plugin's role is identical to `google-services`': teach Claude how to use the underlying tool, plus drive setup. One skill per public tool, all very thin, mostly documentation. A `spotify-shared` skill documents auth, smart-routing convention, error shapes, and global flags. Setup scripts install the server, walk Spotify Developer app registration, drive OAuth, and run a smoke test.

### 4.4 Repo layout

Single repo, lives at `wecoded-marketplace/spotify-services/` inside the WeCoded marketplace.

```
wecoded-marketplace/spotify-services/
├── plugin.json
├── mcp-manifest.json
├── README.md
├── commands/
│   ├── spotify-services-setup.md
│   └── spotify-services-reauth.md
├── mcp-servers/
│   └── spotify-services/
│       └── launcher.sh
├── server/                       # the MCP server source
│   ├── pyproject.toml
│   ├── src/spotify_mcp/
│   │   ├── __main__.py           # MCP server entrypoint
│   │   ├── server.py             # MCP wiring (tool registration)
│   │   ├── auth.py               # PKCE flow, token persistence, refresh
│   │   ├── webapi/
│   │   │   ├── search.py
│   │   │   ├── playlists.py
│   │   │   ├── library.py
│   │   │   ├── playback.py
│   │   │   ├── queue.py
│   │   │   └── user.py
│   │   ├── local/
│   │   │   ├── __init__.py       # platform router
│   │   │   ├── macos.py          # AppleScript wrappers
│   │   │   └── windows.py        # SMTC wrappers via pywinrt
│   │   └── tools/                # MCP tool handlers (smart-routing lives here)
│   └── tests/
├── setup/
│   ├── install-server.sh
│   ├── register-app.md           # walkthrough: register Spotify Developer app
│   ├── ingest-oauth.sh
│   ├── reauth.sh
│   └── smoke-test.sh
├── skills/
│   ├── spotify-shared/
│   ├── spotify-export-all-playlists/
│   ├── spotify-search-tracks/
│   ├── spotify-search-albums/
│   ├── spotify-search-artists/
│   ├── spotify-search-playlists/
│   ├── spotify-now-playing/
│   ├── spotify-playback/
│   ├── spotify-queue-add/
│   ├── spotify-queue-list/
│   ├── spotify-library-saved-tracks/
│   ├── spotify-library-recently-played/
│   ├── spotify-library-top-tracks/
│   ├── spotify-library-top-artists/
│   ├── spotify-library-save/
│   ├── spotify-library-remove/
│   ├── spotify-playlists-list/
│   ├── spotify-playlist-items/
│   ├── spotify-playlist-add-tracks/
│   ├── spotify-playlist-remove-tracks/
│   ├── spotify-playlist-reorder/
│   ├── spotify-playlist-update-details/
│   ├── spotify-user-profile/
│   ├── spotify-devices/
│   └── spotify-transfer-playback/
└── docs/
    └── design.md                 # this file
```

## 5. Tool surface

Grouped by backend. Each tool maps to one skill. Tool-name conventions: lowercase dotted (`namespace.action`).

### 5.1 Local-control tools (no auth, work as long as desktop app is running)

| Tool | macOS | Windows | Notes |
|---|---|---|---|
| `local.play` | ✓ | ✓ | |
| `local.pause` | ✓ | ✓ | |
| `local.next` | ✓ | ✓ | |
| `local.previous` | ✓ | ✓ | |
| `local.now_playing` | ✓ | ✓ | track + artist + album + position when available |
| `local.seek_to` | ✓ | — | SMTC doesn't expose seek |
| `local.set_volume` | ✓ | — | SMTC doesn't expose volume |
| `local.is_running` | ✓ | ✓ | desktop app foregrounded? |
| `local.launch` / `local.quit` | ✓ | macOS only | macOS via AppleScript |

### 5.2 Web API tools (require OAuth; whole plugin assumes Premium — see §3 #3)

| Tool | Notes |
|---|---|
| `search.tracks`, `search.albums`, `search.artists`, `search.playlists` | `limit` capped at 10 by Spotify (Feb 2026), default 5 |
| `playlists.list_mine` | user's own + followed; supports `--all` (auto-paginate) |
| `playlists.get_items` | one playlist's full items via `/playlists/{id}/items`; supports `--all` (Spotify renamed from `/tracks` Feb 2026) |
| `library.saved_tracks` | supports `--all` |
| `library.recently_played` | |
| `library.top_tracks`, `library.top_artists` | scoped by time range |
| `library.save` | uses generic `PUT /me/library` with Spotify URIs (entity-typed endpoints removed Feb 2026) |
| `library.remove` | uses generic `DELETE /me/library` with Spotify URIs (entity-typed endpoints removed Feb 2026) |
| `playback.devices` | list available devices |
| `playback.transfer_to_device` | |
| `playback.play`, `playback.pause`, `playback.next`, `playback.previous`, `playback.seek`, `playback.set_volume`, `playback.set_repeat`, `playback.set_shuffle` | |
| `queue.add` | |
| `queue.list` | |
| `playlist.add_tracks`, `playlist.remove_tracks`, `playlist.reorder`, `playlist.update_details` | |
| `user.profile` | Note: `country`, `email`, `product` fields removed from response Feb 2026 |

### 5.3 Composite / smart-routed tools

| Tool | Backend(s) | Notes |
|---|---|---|
| `now_playing` | local + webapi | reads local instantly; optionally enriches with Web API metadata (track ID, ISRC, album art URL) when `enrich=true` and token is available. Default: `enrich=false` |
| `play_pause_smart` | local first, webapi fallback | one tool that "just works" regardless of whether desktop app is foreground. Free-tier with no local app: surfaces structured `premium_required` error suggesting opening the desktop app (resolved — see §12) |
| `export_all_playlists` | webapi | iterates `playlists.list_mine` + `playlists.get_items` for every playlist; writes one big JSON file at a configurable path. The tutor's specific need. None of the surveyed MCP servers do this in one call. |

### 5.4 Known API limitations (v1 ships without these — do not build skills for them)

The following capabilities are permanently removed as of Spotify's Feb 2026 or Nov 2024 platform changes. Do not build tools or skills for them. Document in `spotify-shared` as "blocked capabilities."

- `playlist.create` — `POST /users/{id}/playlists` removed Feb 2026. Add only if Spotify reinstates an endpoint.
- `library.get_artist_top_tracks` — `/artists/{id}/top-tracks` removed Feb 2026.
- `library.recommendations` — `recommendations` endpoint removed Nov 2024.
- `library.audio_features` / `library.audio_analysis` — removed for new apps Nov 2024.
- `markets` — `/markets` endpoint removed Feb 2026.
- `browse.new_releases` — `/browse/new-releases` removed Feb 2026.
- `several.albums`, `several.artists`, `several.tracks` — all batch GET endpoints removed Feb 2026.

If a future Spotify API change reinstates any of these, add the corresponding tool and skill.

## 6. Setup flow

One-time per user, driven by `/spotify-services-setup`.

1. **Install the MCP server** — `setup/install-server.sh` runs `uv venv` and `uv pip install` from in-tree `server/`. Server installed to `~/.spotify-services/server/`.
2. **Register Spotify Developer app** — `setup/register-app.md` is a walkthrough doc opened in the user's browser. Steps: create app at developer.spotify.com, configure redirect URI as `http://127.0.0.1:8080/callback`, request scopes (full read+write+playback set listed below in §6.1), copy Client ID. Client Secret is optional with PKCE; the walkthrough recommends not requesting one.
3. **OAuth bootstrap** — `setup/ingest-oauth.sh` starts a local listener on `127.0.0.1:8080`, opens the auth URL, captures the redirect, exchanges code for tokens. Tokens land at `~/.spotify-services-secrets/tokens.json` (mode 600).
4. **MCP server registration** — MCP server registration is automatic via YouCoded's `reconcileMcp()`. The plugin ships `mcp-manifest.json` at the plugin root and a launcher at `mcp-servers/spotify-services/launcher.sh`; YouCoded writes `~/.claude.json` on every app start.
5. **Smoke test** — `setup/smoke-test.sh` calls `user.profile`, `local.is_running`, and (if the local app is detected) `local.now_playing`. Reports pass/fail per backend.

### 6.1 OAuth scope set

Request the maximal-but-honest set on first auth so subsequent tools don't trigger re-auth:

- `user-read-private`, `user-read-email`
- `playlist-read-private`, `playlist-read-collaborative`
- `playlist-modify-public`, `playlist-modify-private`
- `user-library-read`, `user-library-modify`
- `user-top-read`, `user-read-recently-played`, `user-read-playback-state`, `user-read-currently-playing`
- `user-modify-playback-state`

The setup walkthrough lists these and explains in plain English what each one unlocks, so the user can opt out of any they don't want and accept that the corresponding tools will return scope errors.

### 6.2 Reauth

`/spotify-services-reauth` for when refresh fails (analog of `gws reauth.sh`). Re-runs the OAuth bootstrap (steps 3–4 above). The server itself auto-refreshes tokens on every Web API call when the access token is within 5 minutes of expiry; manual reauth is only needed when the refresh token itself is rejected.

## 7. Error handling

- **Rate limits (HTTP 429)** — respect `Retry-After`; back off and retry once before surfacing error. After the second failure, surface a structured `{"error": "rate_limited", "retry_after_s": N}` response.
- **Token expiry** — auto-refresh when within 5 minutes of expiry. If refresh itself fails, surface `{"error": "reauth_required", "command": "/spotify-services-reauth"}`.
- **Local backend unavailable** — pure local tools (`local.*`) return `{"error": "desktop_app_not_running"}`. Smart-routed tools fall back to Web API silently and include a `"backend": "webapi_fallback"` field in the response so callers can tell.
- **Premium required** — translate Spotify's 403 with the relevant reason into `{"error": "premium_required", "operation": "..."}`.
- **Scope insufficient** — translate 403 scope errors into `{"error": "scope_missing", "scope": "user-modify-playback-state"}`.

## 8. Testing posture

- **Unit-ish** — mock `spotipy` responses for routing logic, pagination (`--all`), token-refresh-on-expiry, and rate-limit retry. Mock `osascript` subprocess and `pywinrt` calls for local-backend logic.
- **Local-backend integration** — Windows SMTC path tested directly on the development machine (Destin's). macOS AppleScript path tested manually if/when a macOS host is available; otherwise documented as "manually verified on..." in the README.
- **Web API integration** — one end-to-end test against the developer's real account, gated by `SPOTIFY_E2E=1`. Asserts: `user.profile` returns a valid id, `playlists.list_mine` returns ≥ 1 playlist, `export_all_playlists` writes a non-empty file with ≥ N tracks.
- **Setup-flow smoke** — `setup/smoke-test.sh` doubles as both a setup-time check and a CI integration test (gated the same way).

## 9. Security

- **No hardcoded credentials.** The plugin codebase contains no API keys, no Client IDs, no Client Secrets. Each end user registers their own Spotify Developer app.
- **Tokens at rest:** `~/.spotify-services-secrets/tokens.json`, mode 600, in a directory whose path is documented and never inside any Claude Code project repo.
- **No token logging.** The server must redact tokens from any log output. Any `--debug` log level redacts to `bearer ***`.
- **PKCE flow** — the auth code never travels through a remote server; it goes straight from Spotify's redirect to the local listener on `127.0.0.1:8080`.
- **Setup walkthrough warns the user** about the public-marketplace nature of the plugin and the implications (other users with the plugin installed don't get access to the user's account; tokens stay local).

## 10. Out of scope for v1 (deferred capabilities)

- Linux desktop control via MPRIS (added when there's a real consumer asking for it).
- Android support — deferred to v2. Termux ships Python 3 but no `pip`/`uv`; vendoring the full dependency tree is out of scope for v1.
- Podcast / show / episode tools (Spotify treats these as a separate content type; the v1 surface is music-focused).
- Audiobook tools (same reason).
- Playback transfer with rich device-discovery UX (v1 just exposes `playback.devices` + `playback.transfer_to_device`; nicer flows come later).
- Multi-user / shared-account support — v1 assumes one user, one token file.
- Real-time playback monitoring (long-running streams). v1 is request/response only.
- Spotify Connect device authoring (registering this MCP server as its own playback device).

Document each of these in the plugin README's "deferred" section so users don't expect them.

## 11. Versioning and updates

- Plugin and server share a version number (single repo). v1 ships at `0.1.0` to match the `google-services` precedent.
- Breaking changes to MCP tool names or argument shapes bump the minor version (since v1 is `0.x`). Move to semver-strict on `1.0.0`.
- API-side breakage handling: Spotify has now removed endpoints twice (Nov 2024, Feb 2026). When it happens again, the plugin's `spotify-shared` skill is the canonical place to document the gap and which tools are affected.

## 12. Open questions (require user input or follow-up decisions)

1. **Should the plugin live in the existing WeCoded marketplace repo, or its own?** Default assumption: same repo as `google-services`. Confirm during plan phase before initializing the directory.
2. **Linux MPRIS support — punt or include?** Currently punted. Reconsider if there's a demand signal during early use.
3. **Premium-account handling for `play_pause_smart`** — **Resolved:** free-tier with no local app: surface structured `premium_required` error suggesting opening the desktop app. The smart-routed `play_pause_smart` tool surfaces `{"error": "premium_required", "suggestion": "Open the Spotify desktop app to use local transport without Premium."}` in this case.
4. **Setup walkthrough format for `register-app.md`** — does it open in the browser as plain markdown, get rendered server-side, or get printed in the terminal? Match `google-services` precedent during implementation.

## 13. Self-review checklist

- [x] **Placeholders / TBDs:** none in §1–§11. §12 is explicitly a list of open questions to resolve at implementation time, not unfinished spec content (one is now resolved).
- [x] **Internal consistency:** the architecture (§4), tool surface (§5), and setup flow (§6) all describe the same system; OAuth scopes (§6.1) cover all the permissions implied by tools listed in §5.2.
- [x] **Scope:** focused on a single deliverable (the plugin + its MCP server). No drift into "while we're at it, also build X."
- [x] **Ambiguity:** smart-routing rules (§4.2) and error shapes (§7) are explicit; tool surface tables (§5) call out per-tool platform support and Premium requirements.
- [x] **Master-spec relationship:** §1 and §2 explicitly tie the plugin to tutor master spec §3.1, §5.1 #5, §6, §7.1, but the plugin itself is not a Crunchtronics-Tutor-only artifact — its design stands on its own.
- [x] **Feb-2026 API removals:** §3 #1 lists the full removal set and §5.2/§5.4 reflect the current API surface (no removed endpoints in the tool table; removed tools documented in §5.4).
- [x] **Premium assumption:** §3 #3 states the whole-plugin Premium requirement; §5.2 removes per-tool Premium column in favor of the global assumption; §11 versioning does not conflict.

## 14. Spec revision log

- **2026-04-26 (initial draft):** brainstormed plugin shape and tool surface.
- **2026-04-26 (corrections applied in marketplace copy):** marketplace path correction (flat, not under `plugins/`); MCP registration mechanism corrected to declarative `mcp-manifest.json` (was: setup script writes config); Android explicitly punted to v2 (Termux lacks pip/uv); Feb-2026 API deprecation list expanded (was incomplete by ~15 endpoints); Premium-tier requirement broadened to whole plugin (Spotify Dev Mode quota change); `winsdk` → `pywinrt` swap; `now_playing` enrichment defaults to false; free-tier `play_pause_smart` UX resolved.
