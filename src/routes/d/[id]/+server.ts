import type { RequestHandler } from './$types';
import { contentDisposition } from '$lib/server/filename';

const ID_RE = /^[A-Za-z0-9_-]{10}$/;

export const GET: RequestHandler = async ({ params, platform }) => {
	const { id } = params;

	// Validate ID shape before touching storage — rejects garbage without an R2 call.
	if (!ID_RE.test(id)) {
		return new Response('Not found', { status: 404 });
	}

	const listed = await platform!.env.BUCKET.list({ prefix: `${id}/`, limit: 1 });
	if (!listed.objects.length) {
		return new Response('Not found', { status: 404 });
	}

	const obj = listed.objects[0];
	const file = await platform!.env.BUCKET.get(obj.key);
	if (!file) {
		return new Response('Not found', { status: 404 });
	}

	const filename = obj.key.slice(id.length + 1);

	return new Response(file.body, {
		headers: {
			// Never echo a client-provided MIME — combined with nosniff this prevents
			// the browser rendering uploaded HTML/SVG/PDF in our origin's security context.
			'Content-Type': 'application/octet-stream',
			'Content-Disposition': contentDisposition(filename),
			'Content-Length': String(obj.size),
			'X-Content-Type-Options': 'nosniff',
			'Cache-Control': 'private, no-store',
			'Referrer-Policy': 'no-referrer'
		}
	});
};
