import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { makeClient, listObjects } from '$lib/server/r2-sign';

export interface UploadItem {
	id: string;
	filename: string;
	size: number;
	uploaded: string; // ISO date
	downloadUrl: string;
}

export const load: PageServerLoad = async ({ locals, platform, url }) => {
	if (!locals.user) throw redirect(302, '/');

	const items: UploadItem[] = [];

	if (platform?.env) {
		const client = makeClient(platform.env);
		const objects = await listObjects(client, platform.env);

		for (const obj of objects) {
			const slash = obj.key.indexOf('/');
			if (slash === -1) continue;
			const id = obj.key.slice(0, slash);
			const filename = obj.key.slice(slash + 1);
			items.push({
				id,
				filename,
				size: obj.size,
				uploaded: obj.lastModified.toISOString(),
				downloadUrl: `${url.origin}/d/${id}`
			});
		}

		items.sort((a, b) => b.uploaded.localeCompare(a.uploaded));
	}

	return { uploads: items };
};
