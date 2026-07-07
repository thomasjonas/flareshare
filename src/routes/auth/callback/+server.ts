import type { RequestHandler } from "./$types";
import { dev } from "$app/environment";
import { createSession } from "$lib/server/session";

export const GET: RequestHandler = async ({ url, cookies, platform }) => {
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expectedState = cookies.get("oauth_state");

  if (!code || !state || state !== expectedState) {
    return new Response("Invalid OAuth state", { status: 400 });
  }
  cookies.delete("oauth_state", { path: "/" });

  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: platform!.env.GITHUB_CLIENT_ID,
      client_secret: platform!.env.GITHUB_CLIENT_SECRET,
      code,
    }),
  });

  if (!tokenRes.ok) {
    return new Response("Failed to exchange OAuth code", { status: 502 });
  }

  const tokenBody = (await tokenRes.json()) as {
    access_token?: string;
    error?: string;
  };
  if (!tokenBody.access_token) {
    console.error("GitHub token exchange failed:", tokenBody);
    return new Response("No access token received", { status: 502 });
  }
  const { access_token } = tokenBody;

  const userRes = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${access_token}`,
      "User-Agent": "flareshare-app",
    },
  });

  if (!userRes.ok) {
    return new Response("Failed to fetch GitHub user", { status: 502 });
  }

  const user = (await userRes.json()) as { id: number };

  if (user.id !== Number(platform!.env.ALLOWED_GITHUB_ID)) {
    return new Response("Forbidden", { status: 403 });
  }

  const session = await createSession(user.id, platform!.env.SESSION_SECRET);
  cookies.set("session", session, {
    path: "/",
    httpOnly: true,
    secure: !dev,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30,
  });

  return new Response(null, {
    status: 302,
    headers: { Location: `${url.origin}/upload` },
  });
};
