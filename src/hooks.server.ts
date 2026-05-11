import type { Handle } from '@sveltejs/kit';
import { verifySession } from '$lib/server/session';

const PROTECTED = [/^\/upload/, /^\/api\/presign-/, /^\/api\/complete-/, /^\/api\/abort-/];

export const handle: Handle = async ({ event, resolve }) => {
	const cookie = event.cookies.get('session');
	event.locals.user =
		cookie ? await verifySession(cookie, event.platform!.env.SESSION_SECRET) : null;

	if (PROTECTED.some((rx) => rx.test(event.url.pathname)) && !event.locals.user) {
		return new Response('Unauthorized', { status: 401 });
	}

	const response = await resolve(event);

	if (response.headers.get('content-type')?.includes('text/html')) {
		response.headers.set(
			'Content-Security-Policy',
			"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
				"connect-src 'self' https://*.r2.cloudflarestorage.com; " +
				"frame-ancestors 'none'; base-uri 'self';"
		);
		response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
		response.headers.set('Referrer-Policy', 'same-origin');
		response.headers.set('X-Content-Type-Options', 'nosniff');
		response.headers.set('X-Frame-Options', 'DENY');
		response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
	}

	return response;
};
