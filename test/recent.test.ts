/**
 * Unit tests for src/lib/server/recent.ts
 *
 * Pure module — no runtime/env needed.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { groupTransfers } from '../src/lib/server/recent.ts';
import type { S3Object } from '../src/lib/server/r2-sign.ts';
import type { Manifest } from '../src/lib/server/manifest.ts';

const ORIGIN = 'https://example.com';
const ID = 'aBcDeFgHiJ';
const ID2 = 'kLmNoPqRsT';
const ID3 = 'uVwXyZ1234';

function obj(key: string, size: number, modified = new Date('2024-06-01T12:00:00Z')): S3Object {
	return { key, size, lastModified: modified };
}

function manifest(title?: string, fileCount = 2): Manifest {
	return {
		...(title ? { title } : {}),
		files: Array.from({ length: fileCount }, (_, i) => ({
			key: `${ID}/fid${i}/file${i}.txt`,
			filename: `file${i}.txt`,
			size: 100,
			crc32: 'aabbccdd',
			order: i
		}))
	};
}

// ---------------------------------------------------------------------------
// Bundle: manifest present → one row
// ---------------------------------------------------------------------------

test('bundle: manifest present → one row with correct count/size/date/title', () => {
	const t1 = new Date('2024-06-01T10:00:00Z');
	const t2 = new Date('2024-06-01T12:00:00Z');
	const objects: S3Object[] = [
		obj(`${ID}/manifest.json`, 256, t1),
		obj(`${ID}/fid1/file1.txt`, 1000, t1),
		obj(`${ID}/fid2/file2.pdf`, 2000, t2)
	];
	const manifests = new Map<string, Manifest | null>([[ID, manifest('Q2 assets', 2)]]);

	const rows = groupTransfers(objects, manifests, ORIGIN);

	assert.equal(rows.length, 1);
	const [row] = rows;
	assert.equal(row.id, ID);
	assert.equal(row.kind, 'bundle');
	assert.equal(row.title, 'Q2 assets');
	assert.equal(row.fileCount, 2); // manifest.json excluded
	assert.equal(row.size, 3000); // 1000 + 2000
	assert.equal(row.uploaded, t2.toISOString()); // most-recent member date
	assert.equal(row.downloadUrl, `${ORIGIN}/d/${ID}`);
	assert.equal(row.key, undefined);
});

test('bundle: no title in manifest → fallback to flareshare-{id}.zip', () => {
	const objects: S3Object[] = [
		obj(`${ID}/manifest.json`, 100),
		obj(`${ID}/fid1/file1.txt`, 500)
	];
	const manifests = new Map<string, Manifest | null>([[ID, manifest(undefined, 1)]]);

	const rows = groupTransfers(objects, manifests, ORIGIN);

	assert.equal(rows.length, 1);
	assert.equal(rows[0].title, `flareshare-${ID}.zip`);
});

test('bundle: manifest null (failed GET) → row excluded', () => {
	const objects: S3Object[] = [
		obj(`${ID}/manifest.json`, 100),
		obj(`${ID}/fid1/file1.txt`, 500)
	];
	const manifests = new Map<string, Manifest | null>([[ID, null]]);

	const rows = groupTransfers(objects, manifests, ORIGIN);
	assert.equal(rows.length, 0);
});

test('bundle: manifest not in map → row excluded', () => {
	const objects: S3Object[] = [
		obj(`${ID}/manifest.json`, 100),
		obj(`${ID}/fid1/file1.txt`, 500)
	];
	// manifests map is empty — bundle id not fetched
	const rows = groupTransfers(objects, new Map(), ORIGIN);
	assert.equal(rows.length, 0);
});

// ---------------------------------------------------------------------------
// Bundle: sealed lifecycle
// ---------------------------------------------------------------------------

test('bundle: sealed:false → row excluded (in-progress, not yet ready)', () => {
	const objects: S3Object[] = [
		obj(`${ID}/manifest.json`, 100),
		obj(`${ID}/fid1/file1.txt`, 500)
	];
	const m = { ...manifest('Draft', 1), sealed: false };
	const manifests = new Map<string, Manifest | null>([[ID, m]]);

	const rows = groupTransfers(objects, manifests, ORIGIN);
	assert.equal(rows.length, 0);
});

test('bundle: sealed:true → row included as normal', () => {
	const objects: S3Object[] = [
		obj(`${ID}/manifest.json`, 100),
		obj(`${ID}/fid1/file1.txt`, 500)
	];
	const m = { ...manifest('Ready', 1), sealed: true };
	const manifests = new Map<string, Manifest | null>([[ID, m]]);

	const rows = groupTransfers(objects, manifests, ORIGIN);
	assert.equal(rows.length, 1);
	assert.equal(rows[0].title, 'Ready');
});

test('bundle: sealed field absent (legacy manifest) → row included as normal (back-compat)', () => {
	const objects: S3Object[] = [
		obj(`${ID}/manifest.json`, 100),
		obj(`${ID}/fid1/file1.txt`, 500)
	];
	const manifests = new Map<string, Manifest | null>([[ID, manifest('Legacy', 1)]]);

	const rows = groupTransfers(objects, manifests, ORIGIN);
	assert.equal(rows.length, 1);
	assert.equal(rows[0].title, 'Legacy');
});

// ---------------------------------------------------------------------------
// Legacy single: 2-segment key, no manifest
// ---------------------------------------------------------------------------

test('legacy single → individual row', () => {
	const t = new Date('2024-05-15T09:30:00Z');
	const objects: S3Object[] = [obj(`${ID}/report.pdf`, 4096, t)];
	const rows = groupTransfers(objects, new Map(), ORIGIN);

	assert.equal(rows.length, 1);
	const [row] = rows;
	assert.equal(row.id, ID);
	assert.equal(row.kind, 'single');
	assert.equal(row.title, 'report.pdf');
	assert.equal(row.fileCount, 1);
	assert.equal(row.size, 4096);
	assert.equal(row.uploaded, t.toISOString());
	assert.equal(row.downloadUrl, `${ORIGIN}/d/${ID}`);
	assert.equal(row.key, `${ID}/report.pdf`);
});

test('legacy: two separate legacy uploads → two rows', () => {
	const objects: S3Object[] = [
		obj(`${ID}/photo.jpg`, 1000),
		obj(`${ID2}/video.mp4`, 2000)
	];
	const rows = groupTransfers(objects, new Map(), ORIGIN);
	assert.equal(rows.length, 2);
	const ids = new Set(rows.map((r) => r.id));
	assert.ok(ids.has(ID));
	assert.ok(ids.has(ID2));
});

// ---------------------------------------------------------------------------
// Abandoned: 3-segment members, no manifest → excluded
// ---------------------------------------------------------------------------

test('abandoned (3-seg members, no manifest) → no rows', () => {
	const objects: S3Object[] = [
		obj(`${ID}/fid1/a.txt`, 100),
		obj(`${ID}/fid2/b.txt`, 200)
	];
	const rows = groupTransfers(objects, new Map(), ORIGIN);
	assert.equal(rows.length, 0);
});

test('abandoned group excluded even alongside valid transfers', () => {
	const objects: S3Object[] = [
		// abandoned
		obj(`${ID}/fid1/a.txt`, 100),
		// legacy
		obj(`${ID2}/report.pdf`, 500),
		// bundle
		obj(`${ID3}/manifest.json`, 256),
		obj(`${ID3}/fid1/doc.pdf`, 1024)
	];
	const manifests = new Map<string, Manifest | null>([
		[ID3, manifest('My bundle', 1)]
	]);

	const rows = groupTransfers(objects, manifests, ORIGIN);
	assert.equal(rows.length, 2);
	const kinds = rows.map((r) => r.kind);
	assert.ok(kinds.includes('bundle'));
	assert.ok(kinds.includes('single'));
	const ids = rows.map((r) => r.id);
	assert.ok(!ids.includes(ID), 'abandoned id should not appear');
});

// ---------------------------------------------------------------------------
// Mixed input: correct partitioning
// ---------------------------------------------------------------------------

test('mixed input → correct partitioning (bundle + legacy + abandoned)', () => {
	const objects: S3Object[] = [
		// bundle
		obj(`${ID}/manifest.json`, 300),
		obj(`${ID}/fid1/img.png`, 8000),
		obj(`${ID}/fid2/img2.png`, 4000),
		// legacy
		obj(`${ID2}/archive.zip`, 16000),
		// abandoned
		obj(`${ID3}/fid1/orphan.txt`, 50)
	];
	const manifests = new Map<string, Manifest | null>([
		[ID, { title: 'Photos', files: [] }] // files array irrelevant for grouper
	]);

	const rows = groupTransfers(objects, manifests, ORIGIN);

	assert.equal(rows.length, 2);

	const bundle = rows.find((r) => r.id === ID);
	assert.ok(bundle, 'bundle row present');
	assert.equal(bundle?.kind, 'bundle');
	assert.equal(bundle?.fileCount, 2);
	assert.equal(bundle?.size, 12000);

	const single = rows.find((r) => r.id === ID2);
	assert.ok(single, 'legacy row present');
	assert.equal(single?.kind, 'single');
	assert.equal(single?.title, 'archive.zip');
});

// ---------------------------------------------------------------------------
// Ordering: newest first
// ---------------------------------------------------------------------------

test('ordering by uploaded date descending', () => {
	const old = new Date('2024-01-01T00:00:00Z');
	const mid = new Date('2024-06-01T00:00:00Z');
	const recent = new Date('2024-12-01T00:00:00Z');

	const objects: S3Object[] = [
		obj(`${ID}/manifest.json`, 100, old),
		obj(`${ID}/fid1/a.txt`, 500, old),
		obj(`${ID2}/file.pdf`, 200, recent),
		obj(`${ID3}/doc.txt`, 300, mid)
	];
	const manifests = new Map<string, Manifest | null>([
		[ID, manifest('Old bundle', 1)]
	]);

	const rows = groupTransfers(objects, manifests, ORIGIN);

	assert.equal(rows.length, 3);
	// newest first
	assert.equal(rows[0].id, ID2);
	assert.equal(rows[1].id, ID3);
	assert.equal(rows[2].id, ID);
});

// ---------------------------------------------------------------------------
// Edge: bare key (no slash) — skipped
// ---------------------------------------------------------------------------

test('bare key with no slash is silently skipped', () => {
	const objects: S3Object[] = [
		obj('noslash', 100),
		obj(`${ID}/file.txt`, 200)
	];
	const rows = groupTransfers(objects, new Map(), ORIGIN);
	assert.equal(rows.length, 1);
	assert.equal(rows[0].id, ID);
});
