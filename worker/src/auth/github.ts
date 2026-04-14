// GitHub OAuth helpers — token exchange, user fetch, authorize URL builder.
// Used by the device-code flow in routes.ts.

interface GitHubTokenResponse { access_token?: string; error?: string }
interface GitHubUserResponse { id: number; login: string; avatar_url: string }

export async function exchangeCode(
  clientId: string,
  clientSecret: string,
  code: string
): Promise<string> {
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
  });
  const body = (await res.json()) as GitHubTokenResponse;
  if (!body.access_token) throw new Error(`github token exchange failed: ${body.error ?? "unknown"}`);
  return body.access_token;
}

export async function fetchGitHubUser(accessToken: string): Promise<GitHubUserResponse> {
  const res = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": "destincode-marketplace",
      Accept: "application/vnd.github+json",
    },
  });
  if (!res.ok) throw new Error(`github /user failed: ${res.status}`);
  return (await res.json()) as GitHubUserResponse;
}

// csrfState is an opaque random token generated server-side and bound to the
// requesting browser via an HttpOnly cookie; verified on callback.
export function buildAuthorizeUrl(clientId: string, csrfState: string, callback: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callback,
    state: csrfState,
    scope: "read:user",
  });
  return `https://github.com/login/oauth/authorize?${params.toString()}`;
}
