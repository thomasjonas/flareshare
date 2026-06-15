import type { RequestHandler } from './$types';
import { makeClient, deleteObject, listObjects } from '$lib/server/r2-sign';
import { resolveDeleteId } from '$lib/server/bundle-key';

/**
 * POST /api/delete
 *
 * Deletes an entire bundle (all objects under `{id}/`) by normalising both
 * input shapes to a validated bundle id, then prefix-deleting:
 *
 *   { id: string }  — new contract; pass the bundle id directly.
 *   { key: string } — legacy contract; id is derived from the first path
 *                     segment of the key.  A legacy single upload stored at
 *                     `{id}/{filename}` is fully removed by the same prefix
 *                     delete, so no special-casing is needed.
 *
 * Auth required.  Returns 204 in all success cases (including "already gone"
 * — idempotent by design).
 */
export const POST: RequestHandler = async ({ request, platform, locals }) => {
	if (!locals.user) return new Response('Unauthorized', { status: 401 });

	const body = await request.json().catch(() => null);
	if (!body) return new Response('Invalid JSON', { status: 400 });

	let bundleId: string;
	try {
		bundleId = resolveDeleteId(body as Record<string, unknown>);
	} catch (e) {
		return new Response(e instanceof Error ? e.message : 'Invalid request', { status: 400 });
	}

	const env = platform!.env;
	const client = makeClient(env);

	// Always list with a trailing slash so we never accidentally prefix-match
	// a different bundle id that shares a leading substring (even though 10-char
	// fixed-length ids make that impossible, the trailing slash is good hygiene).
	const prefix = `${bundleId}/`;
	const objects = await listObjects(client, env, prefix);

	// Loop deletes — ≤45 members + 1 manifest + 1 list = within Free plan's 50-subrequest budget.
	await Promise.all(objects.map((obj) => deleteObject(client, env, obj.key)));

	return new Response(null, { status: 204 });
};
