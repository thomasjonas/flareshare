import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ cookies, url }) => {
	cookies.delete('session', { path: '/' });
	return new Response(null, {
		status: 302,
		headers: { Location: `${url.origin}/` }
	});
};
