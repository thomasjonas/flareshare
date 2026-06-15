import type { RequestHandler } from './$types';
import { makeClient, createMultipart, presignUploadPart } from '$lib/server/r2-sign';
import { sanitiseFilename } from '$lib/server/filename';
import { newId, newFileId } from '$lib/server/ids';
import { parseBundleId, bundleMemberKey } from '$lib/server/bundle-key';

const MAX_TOTAL = 100 * 1024 * 1024 * 1024; // 100 GB
const MIN_PART = 5 * 1024 * 1024; // 5 MB (S3 minimum, except last part)
const MAX_PART = 5 * 1024 * 1024 * 1024; // 5 GB per part
const MAX_PARTS = 10_000;

export const POST: RequestHandler = async ({ request, platform, url }) => {
	const body = await request.json().catch(() => null);
	if (!body) return new Response('Invalid JSON', { status: 400 });

	const { filename, size, contentType, partSize, partCount, bundleId: rawBundleId } = body as Record<
		string,
		unknown
	>;

	if (typeof size !== 'number' || size <= 0 || size > MAX_TOTAL) {
		return new Response('Invalid size (max 100 GB)', { status: 400 });
	}
	if (typeof partSize !== 'number' || partSize < MIN_PART || partSize > MAX_PART) {
		return new Response('Invalid partSize (5 MB – 5 GB)', { status: 400 });
	}
	if (typeof partCount !== 'number' || partCount < 1 || partCount > MAX_PARTS) {
		return new Response('Invalid partCount (1 – 10000)', { status: 400 });
	}

	// Sanity: partCount must cover total size with last part possibly smaller.
	const minExpected = (partCount - 1) * partSize + 1;
	const maxExpected = partCount * partSize;
	if (size < minExpected || size > maxExpected) {
		return new Response('size / partSize / partCount mismatch', { status: 400 });
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

	const uploadId = await createMultipart(client, platform!.env, key, safeCt);

	const parts: { partNumber: number; url: string; size: number }[] = [];
	for (let i = 1; i <= partCount; i++) {
		const thisSize = i === partCount ? size - (partCount - 1) * partSize : partSize;
		const partUrl = await presignUploadPart(client, platform!.env, key, uploadId, i, 3600);
		parts.push({ partNumber: i, url: partUrl, size: thisSize });
	}

	return Response.json({
		id: bundleId,
		bundleId,
		fileId,
		key,
		uploadId,
		parts,
		downloadUrl: `${url.origin}/d/${bundleId}`
	});
};
