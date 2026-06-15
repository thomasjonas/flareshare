import type { RequestHandler } from './$types';
import { makeClient, presignPut } from '$lib/server/r2-sign';
import { sanitiseFilename } from '$lib/server/filename';
import { newId, newFileId } from '$lib/server/ids';
import { parseBundleId, bundleMemberKey } from '$lib/server/bundle-key';

const MAX_SINGLE_PUT = 5 * 1024 * 1024 * 1024; // 5 GB — R2 single-PUT ceiling

export const POST: RequestHandler = async ({ request, platform, url }) => {
	const body = await request.json().catch(() => null);
	if (!body) return new Response('Invalid JSON', { status: 400 });

	const { filename, size, contentType, bundleId: rawBundleId } = body as Record<string, unknown>;

	if (typeof size !== 'number' || size <= 0 || size > MAX_SINGLE_PUT) {
		return new Response('Invalid size — use multipart endpoint for files >5 GB', { status: 400 });
	}

	const safe = sanitiseFilename(filename);
	if (!safe) return new Response('Invalid filename', { status: 400 });

	let bundleId: string;
	try {
		bundleId = parseBundleId(rawBundleId) ?? newId();
	} catch (err) {
		return new Response(err instanceof Error ? err.message : 'Invalid bundleId', { status: 400 });
	}

	const safeCt = typeof contentType === 'string' ? contentType : 'application/octet-stream';

	const fileId = newFileId();
	const key = bundleMemberKey(bundleId, fileId, safe);

	const client = makeClient(platform!.env);
	const uploadUrl = await presignPut(client, platform!.env, key, size, safeCt, 300);

	return Response.json({
		id: bundleId,
		bundleId,
		fileId,
		key,
		uploadUrl,
		downloadUrl: `${url.origin}/d/${bundleId}`
	});
};
