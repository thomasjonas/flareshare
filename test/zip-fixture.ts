/**
 * Generates a real STORE+ZIP64 archive for the T0 acceptance check: three
 * members, the middle one >4 GiB, so the archive exercises the ZIP64 size
 * field, the trailing-member ZIP64 offset field, and the ZIP64 EOCD + locator.
 *
 * Usage:
 *   node test/zip-fixture.ts [outPath] [bigSizeBytes]
 *   node test/zip-fixture.ts ./fixture.zip 4294967360
 *
 * Defaults to just over 4 GiB. The script streams the big member from a
 * repeating pattern (never holding it in memory) and injects the pattern's
 * precomputed CRC32 — exactly mirroring the production "CRC computed off the
 * Worker" path. It asserts predictZipSize == bytes actually written.
 *
 * Then verify the output round-trips cleanly:
 *   unzip -t fixture.zip                 # must report "No errors detected"
 *   open fixture.zip                     # macOS Archive Utility
 *   (Windows) right-click → Extract All  # Explorer
 */
import { createWriteStream } from 'node:fs';
import { once } from 'node:events';
import { crc32 } from 'node:zlib';
import { zipStream, predictZipSize, type ZipEntry } from '../src/lib/server/zip.ts';

const enc = new TextEncoder();
const BLOCK = 1 << 16; // 64 KiB streaming chunk

const outPath = process.argv[2] ?? './zip-fixture.zip';
const bigSize = Number(process.argv[3] ?? 0x100000000 + 64); // 4 GiB + 64 by default

/** A deterministic, non-trivial 64 KiB pattern block, seeded per member. */
function patternBlock(seed: number): Uint8Array {
	const b = new Uint8Array(BLOCK);
	for (let i = 0; i < BLOCK; i++) b[i] = (i * 31 + seed * 7) & 0xff;
	return b;
}

/** Member backed by a repeating pattern: returns its CRC32 (hex) + a fresh stream. */
function patternMember(name: string, size: number, seed: number): ZipEntry {
	const block = patternBlock(seed);

	// Precompute CRC32 over the exact byte sequence the stream will emit.
	let crc = 0;
	let remaining = size;
	while (remaining > 0) {
		const n = Math.min(BLOCK, remaining);
		crc = crc32(n === BLOCK ? block : block.subarray(0, n), crc);
		remaining -= n;
	}
	const crcHex = (crc >>> 0).toString(16).padStart(8, '0');

	const open = () => {
		let left = size;
		return new ReadableStream<Uint8Array>({
			pull(controller) {
				if (left <= 0) {
					controller.close();
					return;
				}
				const n = Math.min(BLOCK, left);
				controller.enqueue(n === BLOCK ? block : block.subarray(0, n));
				left -= n;
			}
		});
	};

	return { name, size, crc32: crcHex, open };
}

function smallMember(name: string, text: string): ZipEntry {
	const bytes = enc.encode(text);
	return {
		name,
		size: bytes.length,
		crc32: (crc32(bytes) >>> 0).toString(16).padStart(8, '0'),
		open: () =>
			new ReadableStream({
				start(c) {
					c.enqueue(bytes);
					c.close();
				}
			})
	};
}

const entries: ZipEntry[] = [
	smallMember('readme.txt', 'Flareshare ZIP64 STORE fixture.\nThe big member is >4 GiB.\n'),
	patternMember('big.bin', bigSize, 1),
	smallMember('notes/after-big.txt', 'This member sits past the 4 GiB mark (ZIP64 offset).\n')
];

const predicted = predictZipSize(entries.map((e) => ({ name: e.name, size: e.size })));
console.log(`Members:`);
for (const e of entries) {
	console.log(`  ${e.name.padEnd(24)} ${String(e.size).padStart(13)} bytes  crc32=${e.crc32}`);
}
console.log(`Predicted archive size: ${predicted} bytes`);
console.log(`Writing ${outPath} …`);

const out = createWriteStream(outPath);
let written = 0;
const reader = zipStream(entries).getReader();
for (;;) {
	const { value, done } = await reader.read();
	if (done) break;
	written += value.length;
	if (!out.write(value)) await once(out, 'drain');
}
out.end();
await once(out, 'finish');

console.log(`Wrote ${written} bytes.`);
if (written !== predicted) {
	console.error(`MISMATCH: predicted ${predicted} but wrote ${written}`);
	process.exit(1);
}
console.log('OK: predictZipSize matches bytes written.');
console.log(`\nVerify:  unzip -t ${outPath}`);
