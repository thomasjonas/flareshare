import type { RequestHandler } from './$types';
import { dev } from '$app/environment';

export const GET: RequestHandler = async ({ cookies, platform, url }) => {
	const state = crypto.randomUUID();
	cookies.set('oauth_state', state, {
		path: '/',
		httpOnly: true,
		secure: !dev,
		sameSite: 'lax',
		maxAge: 600
	});

	const params = new URLSearchParams({
		client_id: platform!.env.GITHUB_CLIENT_ID,
		redirect_uri: `${url.origin}/auth/callback`,
		scope: 'read:user',
		state
	});

	return new Response(null, {
		status: 302,
		headers: { Location: `https://github.com/login/oauth/authorize?${params}` }
	});
};
