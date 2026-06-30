/**
 * Hand-rolled streaming ZIP encoder — STORE mode only, ZIP64 when required.
 *
 * Design constraints (see docs/BUNDLES.md):
 *  - The Worker must never compute over member bytes. We inject a precomputed
 *    CRC32 (supplied by the caller) into the headers and pipe each member's
 *    bytes through untouched. CPU stays near zero regardless of size.
 *  - Because the CRC and every size are known up front, the total archive byte
 *    length is computable: `predictZipSize` returns exactly the number of bytes
 *    `zipStream` will emit, so the response can set a real `Content-Length`.
 *
 * ZIP64 is emitted per-field, exactly where the classic 32-bit fields overflow:
 *  - a member whose size >= 4 GiB,
 *  - a member whose local-header offset >= 4 GiB (i.e. it sits past the 4 GiB
 *    mark, which happens to every member following a >4 GiB one),
 *  - more than 65535 members, or a central directory that itself crosses 4 GiB.
 */

// Field-size / signature constants.
const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const ZIP64_EOCD_SIG = 0x06064b50;
const ZIP64_LOCATOR_SIG = 0x07064b50;
const ZIP64_EXTRA_ID = 0x0001;

const LOCAL_HEADER_FIXED = 30; // bytes before name + extra
const CENTRAL_HEADER_FIXED = 46; // bytes before name + extra
const ZIP64_EOCD_FIXED = 56;
const ZIP64_LOCATOR_LEN = 20;
const EOCD_LEN = 22;

// Value that no longer fits in a 32-bit field — 0xFFFFFFFF is the sentinel, so
// anything >= it must move to a ZIP64 extra field.
const U32_MAX = 0xffffffff;
const U16_MAX = 0xffff;

// Fixed DOS timestamp: 1980-01-01 00:00:00. A zero date is technically invalid
// and trips warnings in some tools; this is the canonical "no date" value.
const DOS_DATE = 0x0021;
const DOS_TIME = 0x0000;

// General-purpose bit flag: bit 11 = filename is UTF-8. No data descriptor
// (bit 3) since sizes + CRC are known before the header is written.
const GP_FLAG_UTF8 = 0x0800;

const VERSION_ZIP64 = 45; // 4.5 — required to read ZIP64
const VERSION_STORE = 20; // 2.0 — plain STORE
const HOST_UNIX = 3;
// External attrs: regular file, mode 0644, in the high 16 bits.
const EXTERNAL_ATTRS = (0o100644 << 16) >>> 0;

const encoder = new TextEncoder();

export interface ZipEntry {
	name: string;
	size: number;
	/** Precomputed CRC32 as 8-char hex (e.g. "1a2b3c4d") or a uint32 number. */
	crc32: string | number;
	/**
	 * Opens the member's byte stream. Called lazily, one entry at a time in
	 * order, immediately before the bytes are needed — so at most one source
	 * fetch is in flight at once. The returned stream is `pipeTo`'d into the
	 * archive's writable directly: the runtime copies its bytes natively, so
	 * member bytes never cross the JS boundary (see docs/BUNDLES.md — the Worker
	 * must never compute over file bytes).
	 */
	open: () => ReadableStream<Uint8Array> | Promise<ReadableStream<Uint8Array>>;
}

/** What `predictZipSize` needs — no body, no CRC. */
export interface ZipEntrySize {
	name: string;
	size: number;
}

interface PlannedEntry {
	nameBytes: Uint8Array;
	size: number;
	crc: number;
	offset: number; // local-header offset within the archive
	sizeNeedsZip64: boolean;
	offsetNeedsZip64: boolean;
	localExtraLen: number;
	centralExtraLen: number;
	localHeaderLen: number;
	centralHeaderLen: number;
}

interface Plan {
	entries: PlannedEntry[];
	cdOffset: number; // where the central directory begins
	cdSize: number; // total size of all central-directory headers
	needZip64Eocd: boolean;
	totalSize: number;
}

function parseCrc(crc: string | number): number {
	if (typeof crc === 'number') {
		if (!Number.isInteger(crc) || crc < 0 || crc > U32_MAX) {
			throw new RangeError(`crc32 out of uint32 range: ${crc}`);
		}
		return crc >>> 0;
	}
	if (!/^[0-9a-fA-F]{1,8}$/.test(crc)) {
		throw new TypeError(`crc32 must be 1-8 hex chars, got: ${JSON.stringify(crc)}`);
	}
	return parseInt(crc, 16) >>> 0;
}

/**
 * Compute the exact byte layout of the archive. Both `zipStream` and
 * `predictZipSize` go through this so their totals can never drift apart.
 *
 * `crcs` is optional: `predictZipSize` doesn't have CRCs and doesn't need them
 * (they don't affect sizing), so it passes nothing.
 */
function planLayout(entries: ZipEntrySize[], crcs?: (string | number)[]): Plan {
	const planned: PlannedEntry[] = [];
	let offset = 0;

	for (let i = 0; i < entries.length; i++) {
		const e = entries[i];
		if (!Number.isInteger(e.size) || e.size < 0 || !Number.isSafeInteger(e.size)) {
			throw new RangeError(`entry size must be a non-negative safe integer: ${e.size}`);
		}
		const nameBytes = encoder.encode(e.name);
		if (nameBytes.length === 0 || nameBytes.length > U16_MAX) {
			throw new RangeError(`entry name length out of range: ${nameBytes.length}`);
		}

		const sizeNeedsZip64 = e.size >= U32_MAX;
		const offsetNeedsZip64 = offset >= U32_MAX;

		// Local extra: when the size overflows we carry BOTH sizes (uncompressed
		// then compressed) in the ZIP64 extra. Local headers never hold an offset.
		const localExtraLen = sizeNeedsZip64 ? 4 + 16 : 0;

		// Central extra carries only the fields whose 32-bit slot is the sentinel,
		// in fixed order: uncompressed(8), compressed(8), offset(8).
		const centralDataLen = (sizeNeedsZip64 ? 16 : 0) + (offsetNeedsZip64 ? 8 : 0);
		const centralExtraLen = centralDataLen > 0 ? 4 + centralDataLen : 0;

		const localHeaderLen = LOCAL_HEADER_FIXED + nameBytes.length + localExtraLen;
		const centralHeaderLen = CENTRAL_HEADER_FIXED + nameBytes.length + centralExtraLen;

		planned.push({
			nameBytes,
			size: e.size,
			crc: crcs ? parseCrc(crcs[i]) : 0,
			offset,
			sizeNeedsZip64,
			offsetNeedsZip64,
			localExtraLen,
			centralExtraLen,
			localHeaderLen,
			centralHeaderLen
		});

		offset += localHeaderLen + e.size;
	}

	const cdOffset = offset;
	const cdSize = planned.reduce((sum, p) => sum + p.centralHeaderLen, 0);

	const needZip64Eocd =
		entries.length > U16_MAX || cdOffset >= U32_MAX || cdSize >= U32_MAX;

	const tail = needZip64Eocd
		? ZIP64_EOCD_FIXED + ZIP64_LOCATOR_LEN + EOCD_LEN
		: EOCD_LEN;

	return {
		entries: planned,
		cdOffset,
		cdSize,
		needZip64Eocd,
		totalSize: cdOffset + cdSize + tail
	};
}

/** Exact number of bytes `zipStream` will emit for these entries. */
export function predictZipSize(entries: ZipEntrySize[]): number {
	return planLayout(entries).totalSize;
}

// --- byte writing helpers ---------------------------------------------------

class ByteWriter {
	private buf: Uint8Array;
	private view: DataView;
	private pos = 0;

	constructor(size: number) {
		this.buf = new Uint8Array(size);
		this.view = new DataView(this.buf.buffer);
	}

	u16(v: number): this {
		this.view.setUint16(this.pos, v, true);
		this.pos += 2;
		return this;
	}

	u32(v: number): this {
		this.view.setUint32(this.pos, v >>> 0, true);
		this.pos += 4;
		return this;
	}

	u64(v: number): this {
		this.view.setBigUint64(this.pos, BigInt(v), true);
		this.pos += 8;
		return this;
	}

	bytes(b: Uint8Array): this {
		this.buf.set(b, this.pos);
		this.pos += b.length;
		return this;
	}

	done(): Uint8Array {
		if (this.pos !== this.buf.length) {
			throw new Error(`ByteWriter size mismatch: wrote ${this.pos}, allocated ${this.buf.length}`);
		}
		return this.buf;
	}
}

function localHeader(p: PlannedEntry): Uint8Array {
	const w = new ByteWriter(p.localHeaderLen);
	w.u32(LOCAL_SIG)
		.u16(p.sizeNeedsZip64 ? VERSION_ZIP64 : VERSION_STORE)
		.u16(GP_FLAG_UTF8)
		.u16(0) // method: STORE
		.u16(DOS_TIME)
		.u16(DOS_DATE)
		.u32(p.crc)
		.u32(p.sizeNeedsZip64 ? U32_MAX : p.size) // compressed size
		.u32(p.sizeNeedsZip64 ? U32_MAX : p.size) // uncompressed size
		.u16(p.nameBytes.length)
		.u16(p.localExtraLen)
		.bytes(p.nameBytes);

	if (p.sizeNeedsZip64) {
		w.u16(ZIP64_EXTRA_ID)
			.u16(16) // data size: two 8-byte fields
			.u64(p.size) // uncompressed
			.u64(p.size); // compressed
	}
	return w.done();
}

function centralHeader(p: PlannedEntry): Uint8Array {
	const anyZip64 = p.sizeNeedsZip64 || p.offsetNeedsZip64;
	const w = new ByteWriter(p.centralHeaderLen);
	w.u32(CENTRAL_SIG)
		.u16((HOST_UNIX << 8) | VERSION_ZIP64) // version made by
		.u16(anyZip64 ? VERSION_ZIP64 : VERSION_STORE)
		.u16(GP_FLAG_UTF8)
		.u16(0) // method: STORE
		.u16(DOS_TIME)
		.u16(DOS_DATE)
		.u32(p.crc)
		.u32(p.sizeNeedsZip64 ? U32_MAX : p.size) // compressed size
		.u32(p.sizeNeedsZip64 ? U32_MAX : p.size) // uncompressed size
		.u16(p.nameBytes.length)
		.u16(p.centralExtraLen)
		.u16(0) // file comment length
		.u16(0) // disk number start
		.u16(0) // internal attrs
		.u32(EXTERNAL_ATTRS)
		.u32(p.offsetNeedsZip64 ? U32_MAX : p.offset)
		.bytes(p.nameBytes);

	if (p.centralExtraLen > 0) {
		w.u16(ZIP64_EXTRA_ID).u16(p.centralExtraLen - 4);
		// Fixed order; include only the overflowed fields.
		if (p.sizeNeedsZip64) {
			w.u64(p.size).u64(p.size); // uncompressed, compressed
		}
		if (p.offsetNeedsZip64) {
			w.u64(p.offset);
		}
	}
	return w.done();
}

function endRecords(plan: Plan): Uint8Array {
	const count = plan.entries.length;
	const tailLen = plan.needZip64Eocd
		? ZIP64_EOCD_FIXED + ZIP64_LOCATOR_LEN + EOCD_LEN
		: EOCD_LEN;
	const w = new ByteWriter(tailLen);

	if (plan.needZip64Eocd) {
		// ZIP64 end of central directory record.
		w.u32(ZIP64_EOCD_SIG)
			.u64(ZIP64_EOCD_FIXED - 12) // size of remainder of this record
			.u16((HOST_UNIX << 8) | VERSION_ZIP64) // version made by
			.u16(VERSION_ZIP64) // version needed
			.u32(0) // this disk
			.u32(0) // disk with start of CD
			.u64(count) // entries on this disk
			.u64(count) // total entries
			.u64(plan.cdSize)
			.u64(plan.cdOffset);
		// ZIP64 EOCD locator.
		w.u32(ZIP64_LOCATOR_SIG)
			.u32(0) // disk with the ZIP64 EOCD
			.u64(plan.cdOffset + plan.cdSize) // offset of ZIP64 EOCD
			.u32(1); // total number of disks
	}

	// Classic EOCD — present always; overflowed fields fall back to sentinels.
	w.u32(EOCD_SIG)
		.u16(0) // this disk
		.u16(0) // disk with CD
		.u16(count > U16_MAX ? U16_MAX : count)
		.u16(count > U16_MAX ? U16_MAX : count)
		.u32(plan.cdSize >= U32_MAX ? U32_MAX : plan.cdSize)
		.u32(plan.cdOffset >= U32_MAX ? U32_MAX : plan.cdOffset)
		.u16(0); // comment length
	return w.done();
}

/**
 * Stream a STORE-mode ZIP of `entries`. Member bytes are piped through
 * untouched; the supplied `crc32` is injected into the headers. The emitted
 * length is exactly `predictZipSize(entries)`.
 *
 * Member bodies are `pipeTo`'d directly into the archive's writable rather than
 * being read chunk-by-chunk in JS: this lets the runtime copy R2 bytes natively
 * (≈0 CPU), matching the single-file passthrough path. Only the small ZIP
 * headers — which we must build — pass through JS. Pulling member bytes through
 * a JS generator/ReadableStream instead would make CPU scale with archive size
 * and blow the CPU limit on large bundles.
 */
export function zipStream(entries: ZipEntry[]): ReadableStream<Uint8Array> {
	const plan = planLayout(entries, entries.map((e) => e.crc32));
	const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();

	void (async () => {
		// `writer` holds the lock only while we write headers. We release it
		// around each member so its body can pipe straight into `writable`.
		let writer: WritableStreamDefaultWriter<Uint8Array> | null = writable.getWriter();
		try {
			for (let i = 0; i < entries.length; i++) {
				await writer!.write(localHeader(plan.entries[i]));
				writer!.releaseLock();
				writer = null;

				const body = await entries[i].open();
				// preventClose keeps `writable` open for the next member / the
				// central directory; pipeTo releases its writable lock when done.
				await body.pipeTo(writable, { preventClose: true });

				writer = writable.getWriter();
			}

			for (const p of plan.entries) await writer!.write(centralHeader(p));
			await writer!.write(endRecords(plan));
			await writer!.close();
		} catch (err) {
			// If we hold the lock, abort through the writer; otherwise pipeTo has
			// already released it (and, on a source error, aborted `writable`).
			if (writer) await writer.abort(err).catch(() => {});
			else await writable.abort(err).catch(() => {});
		}
	})();

	return readable;
}
