# Flareshare — Bundles Task Breakdown

> Implementation plan for `docs/BUNDLES.md`. Ordered by dependency. Each task is
> independently shippable behind the fact that bundles are inert until a manifest exists —
> existing single-file links are unaffected throughout.

## Phase 0 — De-risk the unknown

### T0. ZIP64 STORE encoder spike (standalone)
The highest-risk, highest-leverage piece. Do this before any UI work.

- Pure function/module: given `[{ name, size, crc32, body: ReadableStream }]`, return a
  `ReadableStream` of a valid STORE-mode ZIP, with ZIP64 when total > 4 GB, any member
  ≥ 4 GB, or > 65535 entries.
- Injects the supplied `crc32` into local + central headers — **never reads/processes
  member bytes** (pipe straight through).
- Also expose `predictZipSize(entries: {name, size}[]) → number` for `Content-Length`.

**Acceptance:** a 3-file fixture (include one >4 GB member to force ZIP64) round-trips
cleanly through **macOS Archive Utility**, **Windows Explorer**, and **`unzip`** — file
contents byte-identical, no "corrupt"/CRC warnings. Unit test asserts `predictZipSize`
equals the actual emitted byte length.

## Phase 1 — Client-side CRC32

### T1. WASM CRC32 helper
- Wrap a WASM CRC32 (`hash-wasm`-class) behind `crc32Stream(blob) → Promise<hex>` and an
  incremental interface for multipart.
- Implement `crc32Combine(crcA, crcB, lenB)` for folding part CRCs in order.

**Acceptance:** unit tests vs known vectors; `combine` of two halves equals CRC of the
whole for several sizes; throughput sanity-checked (≳1 GB/s) so it stays off the Worker.

## Phase 2 — Storage & server endpoints

### T2. `presign-upload` accepts a bundle ID + fileId keys
- Accept optional caller-supplied `bundleId`; mint one only if absent (preserves current
  single-upload callers).
- Key becomes `{bundleId}/{fileId}/{filename}` (`fileId` = short nanoid). Return `key` +
  `fileId`.

**Acceptance:** request with a fixed `bundleId` for two files named identically yields two
distinct keys under the same prefix; legacy call without `bundleId` still works.

### T3. `finalize-bundle` endpoint (new, authed)
- `POST /api/finalize-bundle` `{ id, title?, files: [{ key, filename, size, crc32, order }] }`.
- Auth required (mirror `/api/delete`). Validate: ≤45 files, every `key` starts with
  `{id}/`, shapes/types. Write `{id}/manifest.json`.

**Acceptance:** authed valid call writes the manifest and returns `{ downloadUrl }`;
unauthed → 401; >45 files or a key outside the prefix → 400; manifest JSON matches spec.

### T4. `delete` by bundle ID
- Change `/api/delete` to take a bundle `id`, list the `{id}/` prefix, delete all members
  + `manifest.json`. Keep accepting a legacy single `key` for old uploads, or normalise to
  prefix-delete.

**Acceptance:** deleting a bundle ID removes every object under the prefix; link then 404s;
legacy single-file delete still works.

## Phase 3 — Download

### T5. Manifest-driven `/d/[id]`
- `GET {id}/manifest.json`. **>1 file** → stream T0 encoder over members (by `order`),
  `Content-Disposition` = `title`||`flareshare-{id}.zip`, set `Content-Length` from
  `predictZipSize`. **1 file** → raw passthrough (current behaviour). **Absent** → existing
  legacy single-object path, verbatim.
- No member pre-verify; no prefix listing on the bundle path.
- **Size source:** feed the encoder each member's **manifest `size`** (the value
  `predictZipSize` was computed from) — never R2's live `Content-Length`. The encoder trusts
  the declared size to lay out headers/offsets; if it disagrees with the bytes actually
  streamed, the archive's offsets and the response `Content-Length` are wrong. Stored size is
  the single source of truth.

**Acceptance:** multi-file id streams a valid zip with correct `Content-Length` (browser
shows determinate progress); single-file manifest streams raw; a legacy id (no manifest)
behaves exactly as before; pre-finalize id → 404.

## Phase 4 — Upload UI (tray)

### T6. Tray composition + eager upload
- Convert `upload/+page.svelte` to a transfer tray: mint one `bundleId` on first add; add
  with one `bundleId` per file; eager background upload (reuse presign +
  `putXhrWithProgress`); compute CRC during upload (T1); **remove** aborts/deletes the
  object (reuse abort/delete); enforce **45-file cap**; optional title input.

**Acceptance:** dropping 3 files shows one tray with per-file progress; removing a
mid-upload file aborts it; 46th file is rejected with a clear message.

### T7. "Create link" → finalize
- Button waits for in-flight uploads, gathers `{filename,size,crc32,order}` per member,
  calls T3, shows the single link, resets the tray. Download-before-finalize messaging
  handled by T5's 404.

**Acceptance:** end-to-end — tray of N files produces one link whose zip contains exactly
those files with correct names/contents.

### T8. Recent-transfers list groups by bundle
- `upload/+page.server.ts`: group objects by `{id}` prefix (derive count + total size +
  date from the listing — no per-object link), read each bundle's `manifest.json` for
  `title`/canonical file list. Legacy objects (no manifest) render as today.

**Acceptance:** a finalized bundle appears as one row (title, file count, total size, one
link/delete); legacy single uploads still render individually; abandoned (manifest-less)
prefixes do not appear as valid transfers.

## Suggested merge order

`T0 → T1` (parallel-able) → `T2 → T3 → T5` (server+download usable via curl) →
`T6 → T7 → T8` (UI). Ship after T5 to dogfood via manual finalize, then layer the tray.

## Out of scope (noted, not built)

- Bundle landing page (option B) — possible later add-on.
- Resume / range requests on the zip.
- Mid-stream member verification.
- Lifting the 45-file cap (needs paid Workers + raised subrequests).
