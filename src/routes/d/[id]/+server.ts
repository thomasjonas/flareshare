import type { RequestHandler } from './$types';
import { contentDisposition } from '$lib/server/filename';
import { makeClient, listObjects } from '$lib/server/r2-sign';

const ID_RE = /^[A-Za-z0-9_-]{10}$/;

export const GET: RequestHandler = async ({ params, platform }) => {
	const { id } = params;

	if (!ID_RE.test(id)) {
		return new Response('Not found', { status: 404 });
	}

	const env = platform!.env;
	const client = makeClient(env);

	// Find the object key (we don't know the filename, only the id prefix).
	const all = await listObjects(client, env);
	const obj = all.find((o) => o.key.startsWith(`${id}/`));
	if (!obj) {
		return new Response('Not found', { status: 404 });
	}

	const filename = obj.key.split('/').at(-1) ?? '';
	const encodedKey = obj.key.split('/').map(encodeURIComponent).join('/');
	const fileRes = await client.fetch(
		`${env.R2_ENDPOINT}/${env.R2_BUCKET}/${encodedKey}`,
		{ method: 'GET' }
	);
	if (!fileRes.ok) {
		return new Response('Not found', { status: 404 });
	}

	return new Response(fileRes.body, {
		headers: {
			'Content-Type': 'application/octet-stream',
			'Content-Disposition': contentDisposition(filename),
			'Content-Length': fileRes.headers.get('Content-Length') ?? String(obj.size),
			'X-Content-Type-Options': 'nosniff',
			'Cache-Control': 'private, no-store',
			'Referrer-Policy': 'no-referrer'
		}
	});
};
