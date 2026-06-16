import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { makeClient, listObjects, getObject } from '$lib/server/r2-sign';
import { groupTransfers } from '$lib/server/recent';
import type { Manifest } from '$lib/server/manifest';

export type { TransferRow } from '$lib/server/recent';

export const load: PageServerLoad = async ({ locals, platform, url }) => {
	if (!locals.user) throw redirect(302, '/');

	if (!platform?.env) {
		return { uploads: [] };
	}

	const client = makeClient(platform.env);
	const objects = await listObjects(client, platform.env);

	// --- Identify bundle IDs (prefix has a manifest.json key in the listing) ---
	const bundleIds = new Set<string>();
	for (const obj of objects) {
		const slash = obj.key.indexOf('/');
		if (slash === -1) continue;
		const id = obj.key.slice(0, slash);
		if (obj.key === `${id}/manifest.json`) {
			bundleIds.add(id);
		}
	}

	// --- Fetch manifests for all bundle IDs (1 GET per bundle) ---
	const manifests = new Map<string, Manifest | null>();

	await Promise.all(
		[...bundleIds].map(async (id) => {
			try {
				const res = await getObject(client, platform.env, `${id}/manifest.json`);
				if (res.ok) {
					const parsed = (await res.json()) as Manifest;
					manifests.set(id, parsed);
				} else {
					manifests.set(id, null);
				}
			} catch {
				manifests.set(id, null);
			}
		})
	);

	const uploads = groupTransfers(objects, manifests, url.origin);

	return { uploads };
};
