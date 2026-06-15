/**
 * Pure helpers for bundle key construction and bundleId validation.
 * Kept free of side-effects so they can be unit-tested without any runtime.
 */

/** Same alphabet as nanoid(10); matches what /d/[id] already validates against. */
export const BUNDLE_ID_RE = /^[A-Za-z0-9_-]{10}$/;

/**
 * Parses a caller-supplied bundleId from request JSON.
 * - Returns `null` when the field is absent / undefined / null (caller did not supply one).
 * - Returns the string when it passes BUNDLE_ID_RE validation.
 * - Throws a descriptive string when the value is present but malformed.
 */
export function parseBundleId(raw: unknown): string | null {
	if (raw === undefined || raw === null) return null;
	if (typeof raw !== 'string' || !BUNDLE_ID_RE.test(raw)) {
		throw new Error('Invalid bundleId — must be 10 URL-safe characters [A-Za-z0-9_-]');
	}
	return raw;
}

/**
 * Resolves a delete-request body to a validated bundle id.
 *
 * Accepts either:
 *   { id: string }  — new contract; id must be a valid 10-char bundle id.
 *   { key: string } — legacy contract; id is derived as the first path segment.
 *
 * When both are present, `id` takes precedence.
 * Throws a descriptive Error on invalid or missing input.
 */
export function resolveDeleteId(body: Record<string, unknown>): string {
	const { id, key } = body;

	if (id !== undefined) {
		if (typeof id !== 'string' || !BUNDLE_ID_RE.test(id)) {
			throw new Error('Invalid id — must be 10 URL-safe characters [A-Za-z0-9_-]');
		}
		return id;
	}

	if (key !== undefined) {
		if (typeof key !== 'string') {
			throw new Error('Invalid key — must be a string');
		}
		const firstSegment = key.split('/')[0];
		if (!BUNDLE_ID_RE.test(firstSegment)) {
			throw new Error('Invalid key — first path segment must be a valid 10-char bundle id');
		}
		return firstSegment;
	}

	throw new Error('Request body must include either "id" or "key"');
}

/**
 * Constructs the R2 object key for a bundle member.
 * Three-segment path keeps member keys one level deeper than {bundleId}/manifest.json,
 * preventing any collision with the reserved manifest key.
 */
export function bundleMemberKey(bundleId: string, fileId: string, filename: string): string {
	return `${bundleId}/${fileId}/${filename}`;
}
