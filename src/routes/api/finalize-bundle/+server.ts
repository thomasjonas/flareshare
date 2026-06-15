import type { RequestHandler } from './$types';
import { makeClient, putObject } from '$lib/server/r2-sign';
import { BUNDLE_ID_RE } from '$lib/server/bundle-key';
import { buildManifest } from '$lib/server/manifest';

export const POST: RequestHandler = async ({ request, platform, locals, url }) => {
	if (!locals.user) return new Response('Unauthorized', { status: 401 });

	const body = await request.json().catch(() => null);
	if (!body) return new Response('Invalid JSON', { status: 400 });

	const { id } = body as Record<string, unknown>;
	if (typeof id !== 'string' || !BUNDLE_ID_RE.test(id)) {
		return new Response('Invalid id — must be 10 URL-safe characters [A-Za-z0-9_-]', {
			status: 400
		});
	}

	let manifest;
	try {
		manifest = buildManifest(id, body);
	} catch (err) {
		return new Response((err as Error).message, { status: 400 });
	}

	const env = platform!.env;
	const client = makeClient(env);
	await putObject(client, env, `${id}/manifest.json`, JSON.stringify(manifest), 'application/json');

	const downloadUrl = `${url.origin}/d/${id}`;
	return new Response(JSON.stringify({ downloadUrl }), {
		status: 200,
		headers: { 'content-type': 'application/json' }
	});
};
