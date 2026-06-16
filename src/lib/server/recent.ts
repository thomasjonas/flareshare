/**
 * Pure grouping logic for the recent-transfers list.
 *
 * Kept free of side-effects so it can be unit-tested without any runtime.
 * The loader (upload/+page.server.ts) lists objects, fetches manifests for
 * bundles, then calls groupTransfers.
 */

import type { S3Object } from '$lib/server/r2-sign';
import type { Manifest } from '$lib/server/manifest';

// Mirrors isDirectChild in download-dispatch.ts: a legacy single object
// sits one level under the id ({id}/{filename}); bundle members are deeper.
function isDirectChild(id: string, key: string): boolean {
	const parts = key.split('/');
	return parts.length === 2 && parts[0] === id;
}

/** A single row in the recent-transfers list. */
export interface TransferRow {
	id: string;
	kind: 'bundle' | 'single';
	/** Bundle: manifest title or fallback. Single: the filename. */
	title: string;
	/** Bundle: member count (excluding manifest.json). Single: 1. */
	fileCount: number;
	/** Total size of all member objects (bytes). */
	size: number;
	/** ISO date of the most-recent lastModified among the group's objects. */
	uploaded: string;
	downloadUrl: string;
	/** Object key — present only for legacy singles. */
	key?: string;
}

/**
 * Group S3 objects into TransferRow entries.
 *
 * @param objects   Full listing from R2 (all objects in the bucket).
 * @param manifests Map of bundle id → parsed Manifest (or null if the GET
 *                  failed). Only populated for ids whose listing contains a
 *                  `{id}/manifest.json` key.
 * @param origin    The request origin, e.g. "https://example.com".
 */
export function groupTransfers(
	objects: S3Object[],
	manifests: Map<string, Manifest | null>,
	origin: string
): TransferRow[] {
	// --- 1. Group objects by first path segment (id) ---
	const groups = new Map<string, S3Object[]>();
	for (const obj of objects) {
		const slash = obj.key.indexOf('/');
		if (slash === -1) continue; // bare key — skip
		const id = obj.key.slice(0, slash);
		let bucket = groups.get(id);
		if (!bucket) {
			bucket = [];
			groups.set(id, bucket);
		}
		bucket.push(obj);
	}

	const rows: TransferRow[] = [];

	for (const [id, objs] of groups) {
		const manifestKey = `${id}/manifest.json`;
		const hasManifest = objs.some((o) => o.key === manifestKey);

		if (hasManifest) {
			// --- Bundle ---
			const manifest = manifests.get(id) ?? null;
			if (!manifest) {
				// Manifest GET failed or unreadable — treat as invisible.
				continue;
			}

			const members = objs.filter((o) => o.key !== manifestKey);
			const totalSize = members.reduce((sum, o) => sum + o.size, 0);
			const latestMs = members.reduce(
				(max, o) => Math.max(max, o.lastModified.getTime()),
				0
			);
			// Fall back to manifest.json's own lastModified if no members (empty bundle).
			const manifestObj = objs.find((o) => o.key === manifestKey);
			const uploadedMs =
				latestMs > 0 ? latestMs : (manifestObj?.lastModified.getTime() ?? 0);

			const title = manifest.title || `flareshare-${id}.zip`;

			rows.push({
				id,
				kind: 'bundle',
				title,
				fileCount: members.length,
				size: totalSize,
				uploaded: new Date(uploadedMs).toISOString(),
				downloadUrl: `${origin}/d/${id}`
			});
		} else {
			// --- No manifest: legacy single or abandoned ---
			const directChildren = objs.filter((o) => isDirectChild(id, o.key));

			if (directChildren.length === 0) {
				// Only 3-segment member keys — pre-finalize / abandoned bundle. Skip.
				continue;
			}

			// Legacy uploads: one row per direct child object.
			for (const obj of directChildren) {
				const filename = obj.key.slice(id.length + 1);
				rows.push({
					id,
					kind: 'single',
					title: filename,
					fileCount: 1,
					size: obj.size,
					uploaded: obj.lastModified.toISOString(),
					downloadUrl: `${origin}/d/${id}`,
					key: obj.key
				});
			}
		}
	}

	// Sort newest-first.
	rows.sort((a, b) => b.uploaded.localeCompare(a.uploaded));

	return rows;
}
