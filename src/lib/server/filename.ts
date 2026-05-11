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

// RFC 5987 encoding so non-ASCII filenames work and can't inject header content.
export function contentDisposition(filename: string): string {
	const ascii = filename.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '');
	const encoded = encodeURIComponent(filename);
	return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
