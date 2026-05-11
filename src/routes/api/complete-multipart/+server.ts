import type { RequestHandler } from './$types';
import { makeClient, completeMultipart } from '$lib/server/r2-sign';

export const POST: RequestHandler = async ({ request, platform }) => {
	const body = await request.json().catch(() => null);
	if (!body) return new Response('Invalid JSON', { status: 400 });

	const { key, uploadId, parts } = body as Record<string, unknown>;

	if (typeof key !== 'string' || typeof uploadId !== 'string') {
		return new Response('Missing key or uploadId', { status: 400 });
	}
	if (!Array.isArray(parts) || parts.length === 0) {
		return new Response('parts must be a non-empty array', { status: 400 });
	}

	const client = makeClient(platform!.env);
	await completeMultipart(
		client,
		platform!.env,
		key,
		uploadId,
		parts as { PartNumber: number; ETag: string }[]
	);

	return new Response(null, { status: 204 });
};
