import type { RequestHandler } from './$types';
import { makeClient, abortMultipart } from '$lib/server/r2-sign';

export const POST: RequestHandler = async ({ request, platform }) => {
	const body = await request.json().catch(() => null);
	if (!body) return new Response(null, { status: 204 });

	const { key, uploadId } = body as Record<string, unknown>;

	if (typeof key === 'string' && typeof uploadId === 'string') {
		const client = makeClient(platform!.env);
		// Best-effort; errors are silently swallowed — lifecycle rule is the backstop.
		await abortMultipart(client, platform!.env, key, uploadId).catch(() => {});
	}

	return new Response(null, { status: 204 });
};
