import type { RequestHandler } from './$types';
import { makeClient, deleteObject } from '$lib/server/r2-sign';

const KEY_RE = /^[A-Za-z0-9_-]{10}\/.+$/;

export const POST: RequestHandler = async ({ request, platform, locals }) => {
	if (!locals.user) return new Response('Unauthorized', { status: 401 });

	const body = await request.json().catch(() => null);
	if (!body) return new Response('Invalid JSON', { status: 400 });

	const { key } = body as Record<string, unknown>;
	if (typeof key !== 'string' || !KEY_RE.test(key)) {
		return new Response('Invalid key', { status: 400 });
	}

	const env = platform!.env;
	const client = makeClient(env);
	await deleteObject(client, env, key);

	return new Response(null, { status: 204 });
};
