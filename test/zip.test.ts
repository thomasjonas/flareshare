import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32 } from 'node:zlib';

import { zipStream, predictZipSize, type ZipEntry } from '../src/lib/server/zip.ts';

const enc = new TextEncoder();

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
	return new ReadableStream({
		start(c) {
			c.enqueue(bytes);
			c.close();
		}
	});
}

async function drain(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
	const chunks: Uint8Array[] = [];
	const reader = stream.getReader();
	for (;;) {
		const { value, done } = await reader.read();
		if (done) break;
		chunks.push(value);
	}
	return Buffer.concat(chunks);
}

function hexCrc(bytes: Uint8Array): string {
	return (crc32(Buffer.from(bytes)) >>> 0).toString(16).padStart(8, '0');
}

function hasUnzip(): boolean {
	try {
		execFileSync('unzip', ['-v'], { stdio: 'ignore' });
		return true;
	} catch {
		return false;
	}
}

test('predictZipSize equals actual emitted byte length (small 3-file zip)', async () => {
	const bodies = [enc.encode('hello world\n'), enc.encode('{"a":1}'), enc.encode('')];
	const names = ['readme.txt', 'data.json', 'empty.bin'];
	const entries: ZipEntry[] = names.map((name, i) => ({
		name,
		size: bodies[i].length,
		crc32: hexCrc(bodies[i]),
		open: () => streamOf(bodies[i])
	}));

	const predicted = predictZipSize(entries.map((e) => ({ name: e.name, size: e.size })));
	const actual = await drain(zipStream(entries));

	assert.equal(actual.length, predicted, 'predicted size must match emitted bytes');
});

test('emitted zip round-trips through unzip with byte-identical members', async (t) => {
	if (!hasUnzip()) {
		t.skip('unzip not available');
		return;
	}
	const bodies = [enc.encode('hello world\n'), enc.encode('{"a":1,"b":[2,3]}'), enc.encode('x')];
	const names = ['readme.txt', 'nested/data.json', 'ünïcode.txt'];
	const entries: ZipEntry[] = names.map((name, i) => ({
		name,
		size: bodies[i].length,
		crc32: hexCrc(bodies[i]),
		open: () => streamOf(bodies[i])
	}));

	const buf = await drain(zipStream(entries));
	const dir = mkdtempSync(join(tmpdir(), 'ziptest-'));
	const zipPath = join(dir, 'out.zip');
	writeFileSync(zipPath, buf);

	// `unzip -t` validates every member's CRC and structure.
	const testOut = execFileSync('unzip', ['-t', zipPath], { encoding: 'utf8' });
	assert.match(testOut, /No errors detected/);

	// Each member must extract byte-identical.
	for (let i = 0; i < names.length; i++) {
		const out = execFileSync('unzip', ['-p', zipPath, names[i]]);
		assert.deepEqual(new Uint8Array(out), bodies[i], `member ${names[i]} must be byte-identical`);
	}
});

test('predictZipSize accounts for per-field ZIP64 (size and trailing-offset overflow)', () => {
	// Layout: small, BIG (>4 GiB), small. The third member sits past 4 GiB, so it
	// needs a ZIP64 offset field but not a size field — the asymmetric case.
	const FOUR_GIB = 0x100000000; // 2^32, > U32_MAX sentinel
	const small1 = { name: 'a.txt', size: 10 };
	const big = { name: 'big.bin', size: FOUR_GIB + 123 };
	const small2 = { name: 'b.txt', size: 20 };
	const entries = [small1, big, small2];

	// Recompute the expected total by hand from the spec field sizes.
	const nameLen = (s: string) => enc.encode(s).length;

	// Local headers: 30 + name + (size>=4G ? 20 : 0)
	const localLen = (e: { name: string; size: number }) =>
		30 + nameLen(e.name) + (e.size >= FOUR_GIB ? 20 : 0);

	// Offsets, to know which members cross the 4 GiB mark.
	const offsets: number[] = [];
	let off = 0;
	for (const e of entries) {
		offsets.push(off);
		off += localLen(e) + e.size;
	}
	const cdOffset = off;

	// Central headers: 46 + name + extra; extra carries overflowed fields only.
	const centralLen = (e: { name: string; size: number }, offset: number) => {
		const sizeZ = e.size >= FOUR_GIB;
		const offZ = offset >= FOUR_GIB;
		const data = (sizeZ ? 16 : 0) + (offZ ? 8 : 0);
		return 46 + nameLen(e.name) + (data > 0 ? 4 + data : 0);
	};
	const cdSize = entries.reduce((s, e, i) => s + centralLen(e, offsets[i]), 0);

	// cdOffset crosses 4 GiB (big member), so ZIP64 EOCD + locator are present.
	const tail = 56 + 20 + 22;
	const expected = cdOffset + cdSize + tail;

	assert.equal(predictZipSize(entries), expected);

	// Sanity: exactly the asymmetric member (small2) gets an offset-only extra.
	assert.ok(offsets[1] < FOUR_GIB, 'big starts below 4 GiB');
	assert.ok(offsets[2] >= FOUR_GIB, 'trailing member starts above 4 GiB');
});

test('rejects bad input', () => {
	assert.throws(() => predictZipSize([{ name: '', size: 1 }]), /name length/);
	assert.throws(() => predictZipSize([{ name: 'x', size: -1 }]), /size/);
	assert.throws(
		() => zipStream([{ name: 'x', size: 0, crc32: 'zz', open: () => streamOf(new Uint8Array()) }]),
		/crc32/
	);
});
