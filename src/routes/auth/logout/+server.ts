import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ cookies, url }) => {
	cookies.delete('session', { path: '/' });
	return Response.redirect(`${url.origin}/`, 302);
};
