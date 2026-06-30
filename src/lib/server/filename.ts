export function sanitiseFilename(input: unknown): string | null {
	if (typeof input !== 'string') return null;
	const cleaned = input
		.replace(/[\x00-\x1F\x7F]/g, '')
		.replace(/[/\\]/g, '_')
		.replace(/^\.+/, '')
		.trim()
		.slice(0, 200);
	return cleaned.length > 0 ? cleaned : null;
}

/**
 * Build the download filename for a multi-file ZIP bundle.
 *
 * A bundle title is a display name (e.g. "My Photos"), so it is NOT guaranteed
 * to carry a .zip extension. Without it the browser saves a file the OS can't
 * recognise as an archive, so the user can't unpack it. This guarantees the
 * served filename always ends in .zip, without doubling it up when the title
 * already does (case-insensitively).
 */
export function zipFilename(title: string | undefined, id: string): string {
	const base = title?.trim() ? title.trim() : `flareshare-${id}`;
	return /\.zip$/i.test(base) ? base : `${base}.zip`;
}

// RFC 5987 encoding so non-ASCII filenames work and can't inject header content.
export function contentDisposition(filename: string): string {
	const ascii = filename.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '');
	const encoded = encodeURIComponent(filename);
	return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
