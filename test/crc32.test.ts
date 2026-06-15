/**
 * Tests for src/lib/crc32.ts
 *
 * Uses node:zlib crc32 as the reference implementation for all expected values.
 * hash-wasm WASM is exercised directly; crc32Combine is pure TS.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32 as zlibCrc32 } from 'node:zlib';

import { crc32Stream, createCrc32, crc32Combine } from '../src/lib/crc32.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Reference CRC32 via node:zlib → 8-char lowercase hex. */
function refCrc(data: Uint8Array | Buffer): string {
	return (zlibCrc32(Buffer.from(data)) >>> 0).toString(16).padStart(8, '0');
}

/** Build a Blob from a Uint8Array (Node 24 has Blob globally). */
function makeBlob(data: Uint8Array): Blob {
	return new Blob([data]);
}

/** Fill a buffer with a simple deterministic pattern. */
function filledBuffer(len: number, seed = 0xab): Uint8Array {
	const buf = new Uint8Array(len);
	for (let i = 0; i < len; i++) buf[i] = (seed + i) & 0xff;
	return buf;
}

// ---------------------------------------------------------------------------
// Known-vector tests
// ---------------------------------------------------------------------------

test('crc32Stream — empty blob', async () => {
	const result = await crc32Stream(makeBlob(new Uint8Array(0)));
	assert.equal(result, refCrc(new Uint8Array(0)));
	assert.equal(result.length, 8, 'must be 8-char hex');
});

test('crc32Stream — ASCII string "hello world"', async () => {
	const data = new TextEncoder().encode('hello world');
	const result = await crc32Stream(makeBlob(data));
	assert.equal(result, refCrc(data));
});

test('crc32Stream — binary data 256 bytes', async () => {
	const data = filledBuffer(256);
	const result = await crc32Stream(makeBlob(data));
	assert.equal(result, refCrc(data));
});

test('crc32Stream — 1 MiB blob', async () => {
	const data = filledBuffer(1024 * 1024);
	const result = await crc32Stream(makeBlob(data));
	assert.equal(result, refCrc(data));
});

// ---------------------------------------------------------------------------
// Incremental hasher (createCrc32)
// ---------------------------------------------------------------------------

test('createCrc32 — single update matches crc32Stream', async () => {
	const data = filledBuffer(4096);
	const hasher = await createCrc32();
	hasher.init();
	hasher.update(data);
	const result = hasher.digest('hex').padStart(8, '0');
	assert.equal(result, refCrc(data));
});

test('createCrc32 — multiple updates match full hash', async () => {
	const part1 = filledBuffer(1000, 0x01);
	const part2 = filledBuffer(2000, 0x02);
	const part3 = filledBuffer(3000, 0x03);
	const combined = new Uint8Array(part1.length + part2.length + part3.length);
	combined.set(part1, 0);
	combined.set(part2, part1.length);
	combined.set(part3, part1.length + part2.length);

	const hasher = await createCrc32();
	hasher.init();
	hasher.update(part1);
	hasher.update(part2);
	hasher.update(part3);
	const result = hasher.digest('hex').padStart(8, '0');

	assert.equal(result, refCrc(combined));
});

test('createCrc32 — init() resets state for reuse', async () => {
	const data = filledBuffer(512);
	const hasher = await createCrc32();

	// First run.
	hasher.init();
	hasher.update(data);
	const first = hasher.digest('hex').padStart(8, '0');

	// Second run after reset.
	hasher.init();
	hasher.update(data);
	const second = hasher.digest('hex').padStart(8, '0');

	assert.equal(first, second, 'results must be identical after reset');
	assert.equal(first, refCrc(data));
});

// ---------------------------------------------------------------------------
// crc32Combine — property: combine(crc(A), crc(B), len(B)) === crc(A‖B)
// ---------------------------------------------------------------------------

test('crc32Combine — small strings', () => {
	const a = new TextEncoder().encode('hello ');
	const b = new TextEncoder().encode('world');
	const ab = new Uint8Array(a.length + b.length);
	ab.set(a, 0);
	ab.set(b, a.length);

	const combined = crc32Combine(refCrc(a), refCrc(b), b.length);
	assert.equal(combined, refCrc(ab));
	assert.equal(combined.length, 8);
});

test('crc32Combine — empty B', () => {
	const a = filledBuffer(1000);
	const b = new Uint8Array(0);
	// combine(crc(A), crc(empty), 0) should equal crc(A) regardless of crc(empty)
	const combined = crc32Combine(refCrc(a), refCrc(b), 0);
	assert.equal(combined, refCrc(a));
});

test('crc32Combine — several sizes', () => {
	const sizes = [1, 7, 100, 1000, 65536, 1024 * 1024];

	for (const lenA of [1, 255, 1000]) {
		for (const lenB of sizes) {
			const a = filledBuffer(lenA, 0x11);
			const b = filledBuffer(lenB, 0x22);
			const ab = new Uint8Array(lenA + lenB);
			ab.set(a, 0);
			ab.set(b, lenA);

			const combined = crc32Combine(refCrc(a), refCrc(b), lenB);
			assert.equal(
				combined,
				refCrc(ab),
				`failed for lenA=${lenA} lenB=${lenB}`
			);
		}
	}
});

test('crc32Combine — accepts numeric CRC inputs', () => {
	const a = filledBuffer(500, 0xaa);
	const b = filledBuffer(700, 0xbb);
	const ab = new Uint8Array(1200);
	ab.set(a, 0);
	ab.set(b, 500);

	const numCrcA = zlibCrc32(Buffer.from(a)) >>> 0;
	const numCrcB = zlibCrc32(Buffer.from(b)) >>> 0;

	const combined = crc32Combine(numCrcA, numCrcB, 700);
	assert.equal(combined, refCrc(ab));
});

test('crc32Combine — halves equal whole for large buffer (512 KiB)', () => {
	const total = 512 * 1024;
	const half = total / 2;
	const data = filledBuffer(total, 0x77);
	const a = data.subarray(0, half);
	const b = data.subarray(half);

	const combined = crc32Combine(refCrc(a), refCrc(b), half);
	assert.equal(combined, refCrc(data));
});

// ---------------------------------------------------------------------------
// Throughput sanity check (WASM must be much faster than 200 MB/s)
// ---------------------------------------------------------------------------

test('crc32Stream throughput ≥ 200 MB/s on 64 MiB of data', async () => {
	const SIZE = 64 * 1024 * 1024; // 64 MiB
	const data = new Uint8Array(SIZE);
	// Cheap fill — doesn't matter for throughput measurement.
	data.fill(0xa5);

	const blob = makeBlob(data);
	const t0 = performance.now();
	await crc32Stream(blob);
	const elapsed = performance.now() - t0;

	const mbPerSec = (SIZE / (1024 * 1024)) / (elapsed / 1000);
	console.log(`crc32Stream throughput: ${mbPerSec.toFixed(0)} MB/s (${elapsed.toFixed(1)} ms for 64 MiB)`);

	assert.ok(
		mbPerSec >= 200,
		`Expected ≥ 200 MB/s, got ${mbPerSec.toFixed(0)} MB/s — WASM may not be loading correctly`
	);
});
