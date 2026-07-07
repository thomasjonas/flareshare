/**
 * Unit tests for src/lib/well.ts
 *
 * Pure decision logic — no runtime/env needed.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeWellDisplay, buildOptimisticRow } from '../src/lib/well.ts';
import type { FileEntry, FileStatus } from '../src/lib/upload.ts';

// Local FileEntry builder — deliberately does not import upload.ts at
// runtime (it pulls in $lib/crc32, a SvelteKit-alias-only module that plain
// `node --test` can't resolve). Only the type is imported. Mirrors
// test/reconcile.test.ts's helper.
let nextId = 0;
function entryWith(status: FileStatus, overrides: Partial<FileEntry> = {}): FileEntry {
	const name = overrides.file?.name ?? `file${nextId}.txt`;
	const size = overrides.file?.size ?? 10;
	const order = overrides.order ?? nextId;
	nextId++;
	return {
		id: `entry-${nextId}`,
		file: (overrides.file ?? { name, size }) as File,
		status,
		progress: status === 'done' ? 100 : 0,
		error: '',
		startedAt: 0,
		uploadedBytes: 0,
		speed: 0,
		eta: Infinity,
		order,
		key: `id/fid${order}/${name}`,
		crc32: 'abcd1234',
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// computeWellDisplay
// ---------------------------------------------------------------------------

test('computeWellDisplay: no files → empty', () => {
	assert.deepEqual(computeWellDisplay([], false), { mode: 'empty', updating: false });
	assert.deepEqual(computeWellDisplay([], true), { mode: 'empty', updating: false });
});

test('computeWellDisplay: files present but no link yet → working, even once fully uploaded', () => {
	assert.deepEqual(computeWellDisplay([entryWith('uploading')], false), {
		mode: 'working',
		updating: false,
	});
	assert.deepEqual(computeWellDisplay([entryWith('done')], false), {
		mode: 'working',
		updating: false,
	});
});

test('computeWellDisplay: files settled with an existing link → sealed, not updating', () => {
	assert.deepEqual(computeWellDisplay([entryWith('done')], true), {
		mode: 'sealed',
		updating: false,
	});
});

test('computeWellDisplay: a new upload lands while a link already exists → sealed + updating (link stays visible during re-seal)', () => {
	assert.deepEqual(computeWellDisplay([entryWith('done'), entryWith('uploading')], true), {
		mode: 'sealed',
		updating: true,
	});
	assert.deepEqual(computeWellDisplay([entryWith('done'), entryWith('queued')], true), {
		mode: 'sealed',
		updating: true,
	});
});

test('computeWellDisplay: errored file alongside a done one with a link → sealed, not updating (error is not in flight)', () => {
	assert.deepEqual(computeWellDisplay([entryWith('done'), entryWith('error')], true), {
		mode: 'sealed',
		updating: false,
	});
});

// ---------------------------------------------------------------------------
// buildOptimisticRow
// ---------------------------------------------------------------------------

test('buildOptimisticRow: uses trimmed title, counts only done files, sums their sizes', () => {
	const a = entryWith('done', { file: { name: 'a.txt', size: 100 } as File });
	const b = entryWith('done', { file: { name: 'b.txt', size: 250 } as File });
	const uploading = entryWith('uploading', { file: { name: 'c.txt', size: 999 } as File });

	const row = buildOptimisticRow({
		bundleId: 'bundle01',
		title: '  My Transfer  ',
		files: [a, b, uploading],
		downloadUrl: 'https://example.com/d/bundle01',
	});

	assert.equal(row.id, 'bundle01');
	assert.equal(row.kind, 'bundle');
	assert.equal(row.title, 'My Transfer');
	assert.equal(row.fileCount, 2);
	assert.equal(row.size, 350);
	assert.equal(row.downloadUrl, 'https://example.com/d/bundle01');
	assert.ok(!Number.isNaN(new Date(row.uploaded).getTime()));
});

test('buildOptimisticRow: blank title falls back to flareshare-{id}.zip, mirroring groupTransfers', () => {
	const row = buildOptimisticRow({
		bundleId: 'xyz123',
		title: '   ',
		files: [entryWith('done')],
		downloadUrl: 'https://example.com/d/xyz123',
	});
	assert.equal(row.title, 'flareshare-xyz123.zip');
});
