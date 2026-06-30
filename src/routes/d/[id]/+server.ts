import type { RequestHandler } from './$types';
import type { AwsClient } from 'aws4fetch';
import { contentDisposition } from '$lib/server/filename';
import { makeClient, listObjects, getObject } from '$lib/server/r2-sign';
import { zipStream, predictZipSize } from '$lib/server/zip';
import type { Manifest } from '$lib/server/manifest';
import { findLegacyObject } from '$lib/server/download-dispatch';

const ID_RE = /^[A-Za-z0-9_-]{10}$/;

const SECURITY_HEADERS = {
	'X-Content-Type-Options': 'nosniff',
	'Cache-Control': 'private, no-store',
	'Referrer-Policy': 'no-referrer'
} as const;

/**
 * Open a member's R2 byte stream. Invoked lazily by zipStream, one entry at a
 * time in order, so at most one subrequest is in flight. The returned stream is
 * piped through untouched, so member bytes never cross the JS boundary.
 *
 * On a failed GET this throws. If the failure happens before any bytes are
 * emitted the error propagates through zipStream before headers are sent; if it
 * happens mid-stream the client gets a truncated zip (accepted risk: see
 * docs/BUNDLES.md "Accepted risks").
 */
async function openR2Stream(
	client: AwsClient,
	env: App.Platform['env'],
	key: string
): Promise<ReadableStream<Uint8Array>> {
	const res = await getObject(client, env, key);
	if (!res.ok || !res.body) {
		throw new Error(`R2 GET failed for key "${key}": ${res.status}`);
	}
	return res.body;
}

export const GET: RequestHandler = async ({ params, platform }) => {
	const { id } = params;

	if (!ID_RE.test(id)) {
		return new Response('Not found', { status: 404 });
	}

	const env = platform!.env;
	const client = makeClient(env);

	// ── 1. Try the manifest ─────────────────────────────────────────────────
	const manifestRes = await getObject(client, env, `${id}/manifest.json`);

	if (manifestRes.ok) {
		// Parse manifest defensively; treat malformed JSON as 404 to avoid
		// leaking internals (this should never happen for a well-formed bundle
		// because finalize-bundle validates and writes the manifest).
		let manifest: Manifest;
		try {
			const parsed = (await manifestRes.json()) as unknown;
			if (
				typeof parsed !== 'object' ||
				parsed === null ||
				!Array.isArray((parsed as Record<string, unknown>).files)
			) {
				return new Response('Not found', { status: 404 });
			}
			manifest = parsed as Manifest;
		} catch {
			return new Response('Not found', { status: 404 });
		}

		if (manifest.files.length === 0) {
			return new Response('Not found', { status: 404 });
		}

		// Sort by order ascending — MUST be the same for both predictZipSize and
		// zipStream so their layouts agree exactly.
		const files = manifest.files.slice().sort((a, b) => a.order - b.order);

		// ── Single-file manifest: raw passthrough ────────────────────────────
		if (files.length === 1) {
			const member = files[0];
			const memberRes = await getObject(client, env, member.key);
			if (!memberRes.ok) {
				return new Response('Not found', { status: 404 });
			}
			return new Response(memberRes.body, {
				headers: {
					'Content-Type': 'application/octet-stream',
					'Content-Disposition': contentDisposition(member.filename),
					// Raw passthrough: use live R2 Content-Length (correct here because
					// we are NOT zipping; the encoder's declared-size constraint does
					// not apply to raw passthrough).
					'Content-Length':
						memberRes.headers.get('Content-Length') ?? String(member.size),
					...SECURITY_HEADERS
				}
			});
		}

		// ── Multi-file manifest: stream ZIP ──────────────────────────────────
		// CRITICAL: use manifest `size` for predictZipSize / Content-Length, NEVER
		// R2's live Content-Length.  The encoder lays out offsets from the declared
		// size; a mismatch would corrupt the archive and break Content-Length.
		const entries = files.map((member) => ({
			name: member.filename,
			size: member.size, // manifest size — single source of truth
			crc32: member.crc32,
			open: () => openR2Stream(client, env, member.key)
		}));

		const zipName = manifest.title || `flareshare-${id}.zip`;
		const contentLength = predictZipSize(entries.map((e) => ({ name: e.name, size: e.size })));

		return new Response(zipStream(entries), {
			headers: {
				'Content-Type': 'application/zip',
				'Content-Disposition': contentDisposition(zipName),
				'Content-Length': String(contentLength),
				...SECURITY_HEADERS
			}
		});
	}

	// ── 2. Manifest absent — legacy fallback (verbatim existing logic) ───────
	// Only reached when manifest.json returns 404. Any other R2 error → 404
	// to avoid leaking internals.
	if (manifestRes.status !== 404) {
		return new Response('Not found', { status: 404 });
	}

	// List objects under the {id}/ prefix.  Filter to DIRECT children only
	// (2-segment keys: {id}/{filename}).  A 3-segment key ({id}/{fileId}/{filename})
	// means a pre-finalize bundle whose manifest was never written — we return 404
	// rather than streaming a random member object.
	const prefixObjects = await listObjects(client, env, `${id}/`);
	const legacyObj = findLegacyObject(id, prefixObjects);

	if (!legacyObj) {
		return new Response('Not found', { status: 404 });
	}

	// Stream the single legacy object — this is the pre-bundle code path, kept
	// verbatim so existing single-object share links continue to work.
	const filename = legacyObj.key.split('/').at(-1) ?? '';
	const encodedKey = legacyObj.key.split('/').map(encodeURIComponent).join('/');
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
			'Content-Length': fileRes.headers.get('Content-Length') ?? String(legacyObj.size),
			...SECURITY_HEADERS
		}
	});
};
