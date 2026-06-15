/**
 * Client-side CRC32 helper (runs in the browser during upload).
 *
 * - crc32Stream(blob)  Compute CRC32 of a Blob by streaming through the WASM hasher.
 * - createCrc32()      Factory that returns an incremental WASM-backed hasher
 *                      (init / update / digest), suitable for multipart uploads.
 * - crc32Combine()     Fold the CRC32 of two adjacent byte strings — pure TS
 *                      implementation of zlib's crc32_combine over GF(2), so it
 *                      is unit-testable in Node without WASM.
 *
 * All hex outputs are 8-char lowercase strings compatible with the ZIP encoder's
 * parseCrc() (accepts 1-8 hex chars).
 */

import { createCRC32 } from 'hash-wasm';
import type { IHasher } from 'hash-wasm/dist/lib/WASMInterface.js';

export type { IHasher };

// ---------------------------------------------------------------------------
// GF(2) helpers for crc32_combine
// ---------------------------------------------------------------------------

const GF2_DIM = 32;

/** Multiply a GF(2) vector by a matrix (one column at a time). */
function gf2MatrixTimes(mat: Uint32Array, vec: number): number {
	let sum = 0;
	let i = 0;
	while (vec) {
		if (vec & 1) sum ^= mat[i];
		vec >>>= 1;
		i++;
	}
	return sum >>> 0;
}

/** Square a GF(2) matrix in place into `square`. */
function gf2MatrixSquare(square: Uint32Array, mat: Uint32Array): void {
	for (let n = 0; n < GF2_DIM; n++) {
		square[n] = gf2MatrixTimes(mat, mat[n]);
	}
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Combine the CRC32 of two adjacent byte strings A and B into the CRC32 of
 * their concatenation A‖B.
 *
 * Equivalent to zlib's `crc32_combine`. Pure TS — no WASM, directly testable
 * in Node.
 *
 * @param crcA  CRC32 of A — unsigned 32-bit number or 1-8 char hex string.
 * @param crcB  CRC32 of B — unsigned 32-bit number or 1-8 char hex string.
 * @param lenB  Byte length of B (may exceed 2^32).
 * @returns     8-char lowercase hex string.
 */
export function crc32Combine(
	crcA: string | number,
	crcB: string | number,
	lenB: number
): string {
	let crc1 = parseCrcInput(crcA);
	const crc2 = parseCrcInput(crcB);

	if (lenB <= 0) return uint32ToHex(crc1);

	const odd = new Uint32Array(GF2_DIM);
	const even = new Uint32Array(GF2_DIM);

	// Operator for one zero bit: CRC-32 polynomial in reversed (LSB-first) form.
	odd[0] = 0xedb88320;
	let row = 1;
	for (let n = 1; n < GF2_DIM; n++) {
		odd[n] = row;
		row = (row << 1) >>> 0;
	}

	// Two zero bits.
	gf2MatrixSquare(even, odd);
	// Four zero bits.
	gf2MatrixSquare(odd, even);

	// Use BigInt so we handle lenB values above 2^32 (e.g. >4 GB files).
	let len = BigInt(lenB);

	do {
		gf2MatrixSquare(even, odd);
		if (len & 1n) crc1 = gf2MatrixTimes(even, crc1);
		len >>= 1n;
		if (len === 0n) break;

		gf2MatrixSquare(odd, even);
		if (len & 1n) crc1 = gf2MatrixTimes(odd, crc1);
		len >>= 1n;
	} while (len !== 0n);

	return uint32ToHex((crc1 ^ crc2) >>> 0);
}

/**
 * Create an incremental WASM-backed CRC32 hasher.
 *
 * Usage:
 * ```ts
 * const h = await createCrc32();
 * h.init();
 * for (const chunk of parts) h.update(chunk);
 * const hex = h.digest(); // 8-char lowercase hex
 * ```
 *
 * For multipart uploads: compute each part's CRC this way, then fold in order
 * with `crc32Combine(partCrcs[0], partCrcs[1], partSizes[1])` etc.
 */
export async function createCrc32(): Promise<IHasher> {
	return createCRC32();
}

/**
 * Compute the CRC32 of an entire Blob by streaming it through the WASM hasher.
 *
 * @returns 8-char lowercase hex string.
 */
export async function crc32Stream(blob: Blob): Promise<string> {
	const hasher = await createCRC32();
	hasher.init();

	const reader = blob.stream().getReader();
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			if (value && value.length > 0) hasher.update(value);
		}
	} finally {
		reader.releaseLock();
	}

	return hasher.digest('hex').padStart(8, '0');
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function parseCrcInput(crc: string | number): number {
	if (typeof crc === 'number') return crc >>> 0;
	return parseInt(crc, 16) >>> 0;
}

function uint32ToHex(n: number): string {
	return (n >>> 0).toString(16).padStart(8, '0');
}
