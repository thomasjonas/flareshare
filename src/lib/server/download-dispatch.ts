/**
 * Pure, side-effect-free helpers for the /d/[id] download route.
 *
 * Extracted here so they can be unit-tested without a Cloudflare runtime.
 */

import type { Manifest } from '$lib/server/manifest';

export type DispatchKind = 'zip' | 'single' | 'legacy' | 'not-found' | 'in-progress';

/**
 * Determine how /d/[id] should respond given the outcome of the manifest
 * fetch and (for the legacy path) the objects listed under the id prefix.
 *
 * @param manifestStatus  HTTP status from GET {id}/manifest.json (200 or 404).
 * @param manifest        Parsed manifest when manifestStatus is 200, else null.
 * @param prefixObjects   S3 object keys listed under {id}/ (only used on 404 path).
 * @param id              The bundle id (used for the 2-segment legacy check).
 */
export function chooseDispatch(
	manifestStatus: number,
	manifest: Manifest | null,
	prefixObjects: { key: string }[],
	id: string
): DispatchKind {
	if (manifestStatus === 200 && manifest !== null) {
		// Missing `sealed` is treated as sealed — back-compat for manifests
		// written before this field existed (see ADR 0002).
		if (manifest.sealed === false) return 'in-progress';

		const count = manifest.files.length;
		if (count === 0) return 'not-found';
		if (count === 1) return 'single';
		return 'zip';
	}

	if (manifestStatus === 404) {
		// Legacy fallback: only serve a 2-segment direct child {id}/{filename}.
		// A 3-segment member key ({id}/{fileId}/{filename}) means a pre-finalize
		// bundle — serve 404 rather than streaming a random member file.
		const legacy = findLegacyObject(id, prefixObjects);
		return legacy ? 'legacy' : 'not-found';
	}

	// Any other status (5xx, etc.) is treated as not-found to avoid leaking info.
	return 'not-found';
}

/**
 * Return the first object key that is a DIRECT child of `id` (exactly 2
 * path segments: `{id}/{filename}`).  Returns undefined if none exists.
 */
export function findLegacyObject<T extends { key: string }>(
	id: string,
	objects: T[]
): T | undefined {
	return objects.find((o) => isDirectChild(id, o.key));
}

/**
 * True when `key` has exactly 2 path segments and the first equals `id`.
 * Examples:
 *   isDirectChild("abc", "abc/file.pdf")         → true
 *   isDirectChild("abc", "abc/sub/file.pdf")      → false  (3 segments — bundle member)
 *   isDirectChild("abc", "abc/manifest.json")     → true   (legacy guard keeps manifests out)
 */
export function isDirectChild(id: string, key: string): boolean {
	const segs = key.split('/');
	return segs.length === 2 && segs[0] === id;
}
