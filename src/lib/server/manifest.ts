/**
 * Manifest type definition and pure build/validation logic for bundle manifests.
 *
 * Kept free of side-effects so it can be unit-tested without any runtime.
 * The Manifest type is reused by the download route (T5).
 */

/** Same alphabet/length as the bundle ID used throughout the app. */
const BUNDLE_ID_RE = /^[A-Za-z0-9_-]{10}$/;

/** A single member file record stored in the manifest. */
export interface ManifestFile {
	key: string;
	filename: string;
	size: number;
	crc32: string;
	order: number;
}

/** The shape of {id}/manifest.json written at finalize time. */
export interface Manifest {
	title?: string;
	files: ManifestFile[];
	/**
	 * Lifecycle state: sealed (settled, downloadable) vs unsealed (mid-edit,
	 * shows /in-progress). Absent is treated as sealed — see
	 * docs/adr/0002-sealed-manifest-lifecycle.md for back-compat rationale.
	 */
	sealed?: boolean;
}

const CRC32_RE = /^[0-9a-fA-F]{1,8}$/;
const MAX_FILES = 45;
const MAX_TITLE_LEN = 200;

/**
 * Strip ASCII control characters (0x00-0x1F, 0x7F) and trim surrounding
 * whitespace. Spaces within the title are preserved. Returns empty string
 * if nothing remains after sanitisation.
 */
function sanitiseTitle(raw: string): string {
	return raw
		.replace(/[\x00-\x1f\x7f]/g, '')
		.trim()
		.slice(0, MAX_TITLE_LEN);
}

/**
 * Validate and build a Manifest from a parsed request body.
 *
 * @param id   The bundle ID — already validated against BUNDLE_ID_RE by the caller.
 * @param body The parsed JSON body (full request body object).
 * @throws {Error} with a descriptive message on any validation failure.
 */
export function buildManifest(id: string, body: unknown): Manifest {
	if (!BUNDLE_ID_RE.test(id)) {
		throw new Error('id must match bundle-id format [A-Za-z0-9_-]{10}');
	}
	if (typeof body !== 'object' || body === null || Array.isArray(body)) {
		throw new Error('Request body must be a JSON object');
	}

	const { title: rawTitle, files: rawFiles, sealed: rawSealed } = body as Record<
		string,
		unknown
	>;

	// --- files array ---
	if (!Array.isArray(rawFiles) || rawFiles.length === 0) {
		throw new Error('files must be a non-empty array');
	}
	if (rawFiles.length > MAX_FILES) {
		throw new Error(
			`files must contain at most ${MAX_FILES} entries (got ${rawFiles.length})`
		);
	}

	const files: ManifestFile[] = rawFiles.map((f, i) => {
		if (typeof f !== 'object' || f === null || Array.isArray(f)) {
			throw new Error(`files[${i}]: must be an object`);
		}
		const file = f as Record<string, unknown>;

		// key: string, starts with "{id}/", not the reserved manifest key, 3 segments
		if (typeof file.key !== 'string') {
			throw new Error(`files[${i}].key: must be a string`);
		}
		const key = file.key;
		if (!key.startsWith(`${id}/`)) {
			throw new Error(`files[${i}].key: must start with "${id}/" (got "${key}")`);
		}
		if (key === `${id}/manifest.json`) {
			throw new Error(
				`files[${i}].key: must not be the reserved manifest key "${id}/manifest.json"`
			);
		}
		const segments = key.split('/');
		if (segments.length !== 3) {
			throw new Error(
				`files[${i}].key: must have exactly 3 path segments {id}/{fileId}/{filename} (got ${segments.length})`
			);
		}

		// filename: non-empty string
		if (typeof file.filename !== 'string' || file.filename.length === 0) {
			throw new Error(`files[${i}].filename: must be a non-empty string`);
		}

		// size: non-negative safe integer
		if (
			typeof file.size !== 'number' ||
			!Number.isInteger(file.size) ||
			file.size < 0 ||
			!Number.isSafeInteger(file.size)
		) {
			throw new Error(`files[${i}].size: must be a non-negative safe integer`);
		}

		// crc32: 1-8 hex chars
		if (typeof file.crc32 !== 'string' || !CRC32_RE.test(file.crc32)) {
			throw new Error(`files[${i}].crc32: must be a 1-8 character hex string`);
		}

		// order: non-negative integer
		if (
			typeof file.order !== 'number' ||
			!Number.isInteger(file.order) ||
			file.order < 0
		) {
			throw new Error(`files[${i}].order: must be a non-negative integer`);
		}

		return {
			key,
			filename: file.filename,
			size: file.size,
			crc32: file.crc32,
			order: file.order
		};
	});

	const manifest: Manifest = { files };

	// --- optional title ---
	if (rawTitle !== undefined && rawTitle !== null) {
		if (typeof rawTitle !== 'string') {
			throw new Error('title: must be a string when present');
		}
		const title = sanitiseTitle(rawTitle);
		if (title.length > 0) {
			manifest.title = title;
		}
	}

	// --- optional sealed ---
	if (rawSealed !== undefined) {
		if (typeof rawSealed !== 'boolean') {
			throw new Error('sealed: must be a boolean when present');
		}
		manifest.sealed = rawSealed;
	}

	return manifest;
}
