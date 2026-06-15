/**
 * Unit tests for src/lib/server/manifest.ts
 *
 * Pure module — no runtime/env needed.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildManifest } from '../src/lib/server/manifest.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_ID = 'aBcDeFgHiJ'; // 10 URL-safe chars

function makeFile(overrides: Record<string, unknown> = {}) {
	return {
		key: `${VALID_ID}/fileId0001/report.pdf`,
		filename: 'report.pdf',
		size: 1048576,
		crc32: '1a2b3c4d',
		order: 0,
		...overrides
	};
}

function makeBody(filesOverride?: unknown[], extras: Record<string, unknown> = {}) {
	return {
		id: VALID_ID,
		files: filesOverride ?? [makeFile()],
		...extras
	};
}

// ---------------------------------------------------------------------------
// Valid 1-file bundle
// ---------------------------------------------------------------------------

test('valid 1-file bundle produces correct manifest JSON', () => {
	const manifest = buildManifest(VALID_ID, makeBody());
	assert.deepEqual(manifest, {
		files: [
			{
				key: `${VALID_ID}/fileId0001/report.pdf`,
				filename: 'report.pdf',
				size: 1048576,
				crc32: '1a2b3c4d',
				order: 0
			}
		]
	});
	// title must be absent when not provided
	assert.ok(!('title' in manifest), 'title should be absent from manifest');
});

// ---------------------------------------------------------------------------
// Valid 45-file bundle
// ---------------------------------------------------------------------------

test('valid 45-file bundle produces correct manifest with all files', () => {
	const files = Array.from({ length: 45 }, (_, i) => ({
		key: `${VALID_ID}/fileId${String(i).padStart(4, '0')}/file${i}.txt`,
		filename: `file${i}.txt`,
		size: i * 100,
		crc32: 'aabbccdd',
		order: i
	}));
	const manifest = buildManifest(VALID_ID, { id: VALID_ID, files });
	assert.equal(manifest.files.length, 45);
	assert.ok(!('title' in manifest));
});

// ---------------------------------------------------------------------------
// 46 files → rejected
// ---------------------------------------------------------------------------

test('46 files is rejected with 400-worthy error', () => {
	const files = Array.from({ length: 46 }, (_, i) => ({
		key: `${VALID_ID}/fileId${String(i).padStart(4, '0')}/file${i}.txt`,
		filename: `file${i}.txt`,
		size: 100,
		crc32: 'aabbccdd',
		order: i
	}));
	assert.throws(
		() => buildManifest(VALID_ID, { id: VALID_ID, files }),
		/45/
	);
});

// ---------------------------------------------------------------------------
// key not starting with {id}/
// ---------------------------------------------------------------------------

test('key not starting with bundle id prefix is rejected', () => {
	assert.throws(
		() =>
			buildManifest(
				VALID_ID,
				makeBody([makeFile({ key: 'other00000/fileId0001/report.pdf' })])
			),
		/must start with/
	);
});

// ---------------------------------------------------------------------------
// {id}/manifest.json key → rejected
// ---------------------------------------------------------------------------

test('key equal to the reserved manifest key is rejected', () => {
	assert.throws(
		() =>
			buildManifest(
				VALID_ID,
				makeBody([makeFile({ key: `${VALID_ID}/manifest.json` })])
			),
		/manifest/
	);
});

// ---------------------------------------------------------------------------
// Key with wrong number of segments → rejected
// ---------------------------------------------------------------------------

test('key with only 2 segments (no fileId) is rejected', () => {
	assert.throws(
		() =>
			buildManifest(
				VALID_ID,
				makeBody([makeFile({ key: `${VALID_ID}/report.pdf` })])
			),
		/3 path segments/
	);
});

test('key with 4 segments is rejected', () => {
	assert.throws(
		() =>
			buildManifest(
				VALID_ID,
				makeBody([makeFile({ key: `${VALID_ID}/fileId0001/sub/report.pdf` })])
			),
		/3 path segments/
	);
});

// ---------------------------------------------------------------------------
// Bad crc32
// ---------------------------------------------------------------------------

test('crc32 that is empty string is rejected', () => {
	assert.throws(() => buildManifest(VALID_ID, makeBody([makeFile({ crc32: '' })])), /crc32/);
});

test('crc32 longer than 8 hex chars is rejected', () => {
	assert.throws(
		() => buildManifest(VALID_ID, makeBody([makeFile({ crc32: '1a2b3c4d5e' })])),
		/crc32/
	);
});

test('crc32 with non-hex characters is rejected', () => {
	assert.throws(
		() => buildManifest(VALID_ID, makeBody([makeFile({ crc32: 'zzzzzzzz' })])),
		/crc32/
	);
});

test('crc32 that is a number instead of string is rejected', () => {
	assert.throws(
		() => buildManifest(VALID_ID, makeBody([makeFile({ crc32: 12345678 })])),
		/crc32/
	);
});

// ---------------------------------------------------------------------------
// Bad size
// ---------------------------------------------------------------------------

test('size that is negative is rejected', () => {
	assert.throws(
		() => buildManifest(VALID_ID, makeBody([makeFile({ size: -1 })])),
		/size/
	);
});

test('size that is a float is rejected', () => {
	assert.throws(
		() => buildManifest(VALID_ID, makeBody([makeFile({ size: 1.5 })])),
		/size/
	);
});

test('size that is a string is rejected', () => {
	assert.throws(
		() => buildManifest(VALID_ID, makeBody([makeFile({ size: '1000' })])),
		/size/
	);
});

test('size of 0 is valid (empty file)', () => {
	const manifest = buildManifest(VALID_ID, makeBody([makeFile({ size: 0 })]));
	assert.equal(manifest.files[0].size, 0);
});

// ---------------------------------------------------------------------------
// Bad order
// ---------------------------------------------------------------------------

test('order that is negative is rejected', () => {
	assert.throws(
		() => buildManifest(VALID_ID, makeBody([makeFile({ order: -1 })])),
		/order/
	);
});

test('order that is a float is rejected', () => {
	assert.throws(
		() => buildManifest(VALID_ID, makeBody([makeFile({ order: 0.5 })])),
		/order/
	);
});

test('order of 0 is valid', () => {
	const manifest = buildManifest(VALID_ID, makeBody([makeFile({ order: 0 })]));
	assert.equal(manifest.files[0].order, 0);
});

// ---------------------------------------------------------------------------
// Bad filename
// ---------------------------------------------------------------------------

test('filename that is empty string is rejected', () => {
	assert.throws(
		() => buildManifest(VALID_ID, makeBody([makeFile({ filename: '' })])),
		/filename/
	);
});

test('filename that is a number is rejected', () => {
	assert.throws(
		() => buildManifest(VALID_ID, makeBody([makeFile({ filename: 42 })])),
		/filename/
	);
});

// ---------------------------------------------------------------------------
// Title handling
// ---------------------------------------------------------------------------

test('title omitted from manifest when not provided', () => {
	const manifest = buildManifest(VALID_ID, makeBody());
	assert.ok(!('title' in manifest));
});

test('title included in manifest when provided', () => {
	const manifest = buildManifest(VALID_ID, makeBody(undefined, { title: 'Q2 assets' }));
	assert.equal(manifest.title, 'Q2 assets');
});

test('title omitted from manifest when empty string', () => {
	const manifest = buildManifest(VALID_ID, makeBody(undefined, { title: '' }));
	assert.ok(!('title' in manifest));
});

test('title omitted from manifest when only whitespace', () => {
	const manifest = buildManifest(VALID_ID, makeBody(undefined, { title: '   ' }));
	assert.ok(!('title' in manifest));
});

test('title with spaces preserved (not stripped)', () => {
	const manifest = buildManifest(VALID_ID, makeBody(undefined, { title: 'My transfer files' }));
	assert.equal(manifest.title, 'My transfer files');
});

test('title truncated to 200 chars', () => {
	const longTitle = 'a'.repeat(300);
	const manifest = buildManifest(VALID_ID, makeBody(undefined, { title: longTitle }));
	assert.equal(manifest.title?.length, 200);
});

test('title control chars stripped', () => {
	const manifest = buildManifest(
		VALID_ID,
		makeBody(undefined, { title: 'hello\x00world\x1f!' })
	);
	assert.equal(manifest.title, 'helloworld!');
});

test('title that is a number is rejected', () => {
	assert.throws(
		() => buildManifest(VALID_ID, makeBody(undefined, { title: 42 })),
		/title/
	);
});

// ---------------------------------------------------------------------------
// Empty files array
// ---------------------------------------------------------------------------

test('empty files array is rejected', () => {
	assert.throws(() => buildManifest(VALID_ID, { id: VALID_ID, files: [] }), /non-empty/);
});

test('files missing entirely is rejected', () => {
	assert.throws(() => buildManifest(VALID_ID, { id: VALID_ID }), /non-empty/);
});
