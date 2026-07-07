/**
 * Unit tests for src/lib/reconcile.ts
 *
 * Pure decision logic — no runtime/env needed.
 */

import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

import { computeReconcileAction, createReconciler } from '../src/lib/reconcile.ts';
import type { FileEntry, FileStatus } from '../src/lib/upload.ts';

// Local FileEntry builder — deliberately does not import upload.ts at
// runtime (it pulls in $lib/crc32, a SvelteKit-alias-only module that plain
// `node --test` can't resolve). Only the type is imported.
let nextId = 0;
function entryWith(status: FileStatus, overrides: Partial<FileEntry> = {}): FileEntry {
	const name = overrides.file?.name ?? `file${nextId}.txt`;
	const order = overrides.order ?? nextId;
	nextId++;
	return {
		id: `entry-${nextId}`,
		file: (overrides.file ?? { name, size: 10 }) as File,
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

test('computeReconcileAction: empty tray → delete', () => {
	assert.deepEqual(computeReconcileAction([]), { type: 'delete' });
});

test('computeReconcileAction: only queued/uploading, nothing done → skip (no manifest possible yet)', () => {
	const files = [entryWith('queued'), entryWith('uploading')];
	assert.deepEqual(computeReconcileAction(files), { type: 'skip' });
});

test('computeReconcileAction: one done, nothing in flight → write sealed:true', () => {
	const done = entryWith('done');
	const action = computeReconcileAction([done]);
	assert.equal(action.type, 'write');
	if (action.type === 'write') {
		assert.equal(action.sealed, true);
		assert.deepEqual(action.members, [done]);
	}
});

test('computeReconcileAction: one done + one uploading → write sealed:false, uploading file excluded from members', () => {
	const done = entryWith('done');
	const uploading = entryWith('uploading');
	const action = computeReconcileAction([done, uploading]);
	assert.equal(action.type, 'write');
	if (action.type === 'write') {
		assert.equal(action.sealed, false);
		assert.deepEqual(action.members, [done]);
	}
});

test('computeReconcileAction: one done + one queued → write sealed:false (queued also counts as in flight)', () => {
	const done = entryWith('done');
	const queued = entryWith('queued');
	const action = computeReconcileAction([done, queued]);
	assert.equal(action.type, 'write');
	if (action.type === 'write') assert.equal(action.sealed, false);
});

test('computeReconcileAction: one done + one error → write sealed:true (error is not in flight, not a member)', () => {
	const done = entryWith('done');
	const errored = entryWith('error');
	const action = computeReconcileAction([done, errored]);
	assert.equal(action.type, 'write');
	if (action.type === 'write') {
		assert.equal(action.sealed, true);
		assert.deepEqual(action.members, [done]);
	}
});

test('computeReconcileAction: all files errored, none done, none in flight → delete', () => {
	const files = [entryWith('error'), entryWith('aborted')];
	assert.deepEqual(computeReconcileAction(files), { type: 'delete' });
});

test('computeReconcileAction: multiple done files → all included as members, order preserved', () => {
	const a = entryWith('done', { order: 0 });
	const b = entryWith('done', { order: 1 });
	const action = computeReconcileAction([a, b]);
	assert.equal(action.type, 'write');
	if (action.type === 'write') assert.deepEqual(action.members, [a, b]);
});

// ---------------------------------------------------------------------------
// createReconciler — debounce, serialization, trailing reconcile, and the
// no-premature-seal race invariant.
// ---------------------------------------------------------------------------

/** A promise plus externally-callable resolve/reject, for controlling exactly
 * when an in-flight "write" settles in a test. */
function deferred<T>() {
	let resolve!: (v: T) => void;
	let reject!: (e: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

test('createReconciler: schedule() debounces — write not called before the debounce window elapses', () => {
	mock.timers.enable({ apis: ['setTimeout'] });
	try {
		let files: FileEntry[] = [entryWith('done')];
		const writeCalls: unknown[] = [];
		const reconciler = createReconciler({
			debounceMs: 400,
			getState: () => ({ bundleId: 'bundle01', title: '', files }),
			write: async (...args) => {
				writeCalls.push(args);
			},
			del: async () => {},
		});

		reconciler.schedule();
		mock.timers.tick(399);
		assert.equal(writeCalls.length, 0, 'must not fire before the debounce window elapses');

		mock.timers.tick(1);
		assert.equal(writeCalls.length, 1, 'fires once the debounce window elapses');
	} finally {
		mock.timers.reset();
	}
});

test('createReconciler: a burst of schedule() calls within the window collapses into a single write', () => {
	mock.timers.enable({ apis: ['setTimeout'] });
	try {
		let files: FileEntry[] = [entryWith('done')];
		const writeCalls: unknown[] = [];
		const reconciler = createReconciler({
			debounceMs: 400,
			getState: () => ({ bundleId: 'bundle01', title: '', files }),
			write: async (...args) => {
				writeCalls.push(args);
			},
			del: async () => {},
		});

		reconciler.schedule();
		mock.timers.tick(200);
		reconciler.schedule(); // resets the timer
		mock.timers.tick(200);
		reconciler.schedule(); // resets again
		mock.timers.tick(399);
		assert.equal(writeCalls.length, 0);
		mock.timers.tick(1);
		assert.equal(writeCalls.length, 1, 'the burst collapsed into exactly one write');
	} finally {
		mock.timers.reset();
	}
});

test('createReconciler: reads LIVE state at fire time, not state captured when scheduled', () => {
	mock.timers.enable({ apis: ['setTimeout'] });
	try {
		let files: FileEntry[] = [entryWith('uploading')]; // nothing done yet when scheduled
		const writeCalls: { sealed: boolean; members: FileEntry[] }[] = [];
		const reconciler = createReconciler({
			debounceMs: 400,
			getState: () => ({ bundleId: 'bundle01', title: '', files }),
			write: async (_bundleId, _title, members, sealed) => {
				writeCalls.push({ sealed, members });
			},
			del: async () => {},
		});

		reconciler.schedule();
		// Before the debounce fires, the upload finishes — live state changes.
		const done = entryWith('done');
		files = [done];
		mock.timers.tick(400);

		assert.equal(writeCalls.length, 1);
		assert.equal(writeCalls[0].sealed, true);
		assert.deepEqual(writeCalls[0].members, [done]);
	} finally {
		mock.timers.reset();
	}
});

test('createReconciler: never runs a second write while one is in flight (serialized)', async () => {
	mock.timers.enable({ apis: ['setTimeout'] });
	try {
		let files: FileEntry[] = [entryWith('done')];
		let concurrentWrites = 0;
		let maxConcurrentWrites = 0;
		const first = deferred<void>();
		let callCount = 0;

		const reconciler = createReconciler({
			debounceMs: 400,
			getState: () => ({ bundleId: 'bundle01', title: '', files }),
			write: async () => {
				callCount++;
				concurrentWrites++;
				maxConcurrentWrites = Math.max(maxConcurrentWrites, concurrentWrites);
				if (callCount === 1) await first.promise;
				concurrentWrites--;
			},
			del: async () => {},
		});

		reconciler.schedule();
		mock.timers.tick(400); // first write starts, awaiting `first`

		// A second file starts uploading while the first write is still in flight.
		files = [files[0], entryWith('uploading')];
		reconciler.schedule();
		mock.timers.tick(400); // debounce elapses while write #1 is still pending

		assert.equal(callCount, 1, 'must not start a second concurrent write');

		first.resolve();
		await first.promise; // let microtasks drain
		await Promise.resolve();
		await Promise.resolve();

		assert.equal(maxConcurrentWrites, 1, 'writes were never concurrent');
		assert.equal(callCount, 2, 'a trailing reconcile fired once the first write settled');
	} finally {
		mock.timers.reset();
	}
});

test('createReconciler: no-premature-seal race — trailing write after settle reflects sealed:false while the new upload is still in flight', async () => {
	mock.timers.enable({ apis: ['setTimeout'] });
	try {
		const fileA = entryWith('done');
		let files: FileEntry[] = [fileA];
		const writeCalls: { sealed: boolean; members: FileEntry[] }[] = [];
		const gate = deferred<void>();
		let callCount = 0;

		const reconciler = createReconciler({
			debounceMs: 400,
			getState: () => ({ bundleId: 'bundle01', title: '', files }),
			write: async (_bundleId, _title, members, sealed) => {
				callCount++;
				if (callCount === 1) await gate.promise;
				writeCalls.push({ sealed, members });
			},
			del: async () => {},
		});

		// Reconcile scheduled while fileA is the only, settled file → will want sealed:true.
		reconciler.schedule();
		mock.timers.tick(400);
		assert.equal(callCount, 1, 'first write started');

		// Before that write resolves, a second upload starts (rapid add).
		const fileB = entryWith('uploading');
		files = [fileA, fileB];
		reconciler.schedule();
		mock.timers.tick(400);

		// Let the first write finish now.
		gate.resolve();
		await gate.promise;
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();

		assert.equal(writeCalls.length, 2);
		assert.deepEqual(writeCalls[0], { sealed: true, members: [fileA] });
		// The trailing write must reflect the new upload being in flight — never
		// sealed:true while fileB is uploading. This is the core invariant: the
		// second write is triggered by fileB starting, and by the time it
		// actually executes it reads live state (fileB still 'uploading'), so it
		// correctly reports sealed:false instead of racing to a stale sealed:true.
		assert.deepEqual(writeCalls[1], { sealed: false, members: [fileA] });
	} finally {
		mock.timers.reset();
	}
});

test('createReconciler: delete action calls del(), not write()', () => {
	mock.timers.enable({ apis: ['setTimeout'] });
	try {
		let files: FileEntry[] = [];
		const writeCalls: unknown[] = [];
		const delCalls: string[] = [];
		const reconciler = createReconciler({
			debounceMs: 400,
			getState: () => ({ bundleId: 'bundle01', title: '', files }),
			write: async (...args) => {
				writeCalls.push(args);
			},
			del: async id => {
				delCalls.push(id);
			},
		});

		reconciler.schedule();
		mock.timers.tick(400);
		assert.deepEqual(delCalls, ['bundle01']);
		assert.equal(writeCalls.length, 0);
	} finally {
		mock.timers.reset();
	}
});

test('createReconciler: skip action calls neither write() nor del()', () => {
	mock.timers.enable({ apis: ['setTimeout'] });
	try {
		let files: FileEntry[] = [entryWith('uploading')];
		const writeCalls: unknown[] = [];
		const delCalls: unknown[] = [];
		const reconciler = createReconciler({
			debounceMs: 400,
			getState: () => ({ bundleId: 'bundle01', title: '', files }),
			write: async (...args) => {
				writeCalls.push(args);
			},
			del: async (...args) => {
				delCalls.push(args);
			},
		});

		reconciler.schedule();
		mock.timers.tick(400);
		assert.equal(writeCalls.length, 0);
		assert.equal(delCalls.length, 0);
	} finally {
		mock.timers.reset();
	}
});

test('createReconciler: no bundleId → no-op even after the debounce window elapses', () => {
	mock.timers.enable({ apis: ['setTimeout'] });
	try {
		let files: FileEntry[] = [entryWith('done')];
		const writeCalls: unknown[] = [];
		const reconciler = createReconciler({
			debounceMs: 400,
			getState: () => ({ bundleId: null, title: '', files }),
			write: async (...args) => {
				writeCalls.push(args);
			},
			del: async () => {},
		});

		reconciler.schedule();
		mock.timers.tick(400);
		assert.equal(writeCalls.length, 0);
	} finally {
		mock.timers.reset();
	}
});
