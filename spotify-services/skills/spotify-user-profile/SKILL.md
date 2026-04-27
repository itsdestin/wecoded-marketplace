---
name: spotify-user-profile
description: "Spotify Services: Read the authenticated user's Spotify profile."
metadata:
  version: 0.1.0
  openclaw:
    category: "integrations"
---

# User Profile

Fetch your authenticated Spotify profile information — display name, Spotify URI,
follower count, and subscription tier. Note: some fields may be absent post-Feb-2026
depending on platform settings.

## When to use this

- "Show my Spotify profile info"
- "What's my username?"
- "Tell me how many followers I have"

## Tools

| Tool | Args | Returns |
|------|------|---------|
| `user.profile` | (none) | Spotify user object: `{id, display_name, external_urls, followers, href, images, uri, [country], [email], [product]}` |

## Examples

### Example 1: Get profile info

User says: "Show my Spotify profile"
Claude calls: `user.profile` with `{}`.
Returns: `{id: "alice123", display_name: "Alice", followers: {total: 42}, uri: "spotify:user:alice123", product: "premium", country: "US", email: "alice@example.com", ...}`.

## Notes

- Fields `country`, `email`, and `product` may be absent post-Feb-2026 depending on privacy settings
- `product` indicates subscription tier (premium, free)
- All fields are read-only; profile editing is not supported via this tool
- `followers.total` is your follower count

## Errors

This skill can return any of the standard errors documented in `spotify-shared`.
Common ones for this skill:

- `reauth_required` — your Spotify auth is stale; run `/spotify-services-reauth`

## See also

- `spotify-shared` — auth, error shapes, smart routing
- `spotify-library` — read your saved tracks and top items
