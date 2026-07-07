/**
 * Unit tests for src/lib/server/download-dispatch.ts
 *
 * Pure module — no runtime/env needed.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	isDirectChild,
	findLegacyObject,
	chooseDispatch
} from '../src/lib/server/download-dispatch.ts';

const ID = 'aBcDeFgHiJ';

// ---------------------------------------------------------------------------
// isDirectChild
// ---------------------------------------------------------------------------

test('isDirectChild: true for 2-segment key matching id', () => {
	assert.equal(isDirectChild(ID, `${ID}/file.pdf`), true);
});

test('isDirectChild: true for manifest.json key (guard filters this separately)', () => {
	// isDirectChild itself does not exclude manifest.json — the legacy fallback
	// will simply never have a manifest.json in the prefix listing because if it
	// existed the manifest fetch would have returned 200, not 404.
	assert.equal(isDirectChild(ID, `${ID}/manifest.json`), true);
});

test('isDirectChild: false for 3-segment bundle member key', () => {
	assert.equal(isDirectChild(ID, `${ID}/fileId001/report.pdf`), false);
});

test('isDirectChild: false for different id', () => {
	assert.equal(isDirectChild(ID, `otherId000/file.pdf`), false);
});

test('isDirectChild: false for single-segment key', () => {
	assert.equal(isDirectChild(ID, `${ID}`), false);
});

// ---------------------------------------------------------------------------
// findLegacyObject
// ---------------------------------------------------------------------------

test('findLegacyObject: returns direct child object', () => {
	const objects = [{ key: `${ID}/video.mp4`, size: 100 }];
	const result = findLegacyObject(ID, objects);
	assert.deepEqual(result, objects[0]);
});

test('findLegacyObject: ignores 3-segment member keys (pre-finalize bundle)', () => {
	const objects = [
		{ key: `${ID}/fileId001/report.pdf`, size: 200 },
		{ key: `${ID}/fileId002/photo.jpg`, size: 300 }
	];
	assert.equal(findLegacyObject(ID, objects), undefined);
});

test('findLegacyObject: returns undefined for empty list', () => {
	assert.equal(findLegacyObject(ID, []), undefined);
});

test('findLegacyObject: picks first 2-segment key among mixed segments', () => {
	const objects = [
		{ key: `${ID}/fileId001/a.txt`, size: 10 }, // 3-segment, skip
		{ key: `${ID}/legacy.zip`, size: 50 }         // 2-segment, match
	];
	assert.equal(findLegacyObject(ID, objects)?.key, `${ID}/legacy.zip`);
});

// ---------------------------------------------------------------------------
// chooseDispatch
// ---------------------------------------------------------------------------

const noObjects: { key: string }[] = [];

function manifest(fileCount: number) {
	const files = Array.from({ length: fileCount }, (_, i) => ({
		key: `${ID}/fid${i}/f${i}.txt`,
		filename: `f${i}.txt`,
		size: 100,
		crc32: 'aabbccdd',
		order: i
	}));
	return { files };
}

test('chooseDispatch: manifest with >1 files → zip', () => {
	assert.equal(chooseDispatch(200, manifest(3), noObjects, ID), 'zip');
});

test('chooseDispatch: manifest with exactly 1 file → single', () => {
	assert.equal(chooseDispatch(200, manifest(1), noObjects, ID), 'single');
});

test('chooseDispatch: manifest with 0 files → not-found', () => {
	assert.equal(chooseDispatch(200, manifest(0), noObjects, ID), 'not-found');
});

test('chooseDispatch: manifest absent, legacy object present → legacy', () => {
	const objects = [{ key: `${ID}/file.pdf` }];
	assert.equal(chooseDispatch(404, null, objects, ID), 'legacy');
});

test('chooseDispatch: manifest absent, only 3-segment members → not-found (pre-finalize bundle)', () => {
	const objects = [
		{ key: `${ID}/fileId001/a.txt` },
		{ key: `${ID}/fileId002/b.txt` }
	];
	assert.equal(chooseDispatch(404, null, objects, ID), 'not-found');
});

test('chooseDispatch: manifest absent, no objects → not-found', () => {
	assert.equal(chooseDispatch(404, null, noObjects, ID), 'not-found');
});

test('chooseDispatch: unexpected R2 status (5xx) → not-found', () => {
	assert.equal(chooseDispatch(500, null, noObjects, ID), 'not-found');
});

// ---------------------------------------------------------------------------
// chooseDispatch: sealed lifecycle
// ---------------------------------------------------------------------------

test('chooseDispatch: sealed:true manifest → downloads as normal (zip)', () => {
	const m = { ...manifest(3), sealed: true };
	assert.equal(chooseDispatch(200, m, noObjects, ID), 'zip');
});

test('chooseDispatch: sealed:false manifest → in-progress', () => {
	const m = { ...manifest(3), sealed: false };
	assert.equal(chooseDispatch(200, m, noObjects, ID), 'in-progress');
});

test('chooseDispatch: sealed field absent (legacy manifest) → downloads as normal', () => {
	assert.equal(chooseDispatch(200, manifest(1), noObjects, ID), 'single');
});

test('chooseDispatch: no manifest at all (pre-manifest legacy era) → unaffected by sealed logic', () => {
	const objects = [{ key: `${ID}/file.pdf` }];
	assert.equal(chooseDispatch(404, null, objects, ID), 'legacy');
});
