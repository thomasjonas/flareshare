# Flareshare — Multi-file Bundles (Design Note)

> Proposed feature. Not yet implemented. Adds multi-file transfers that download as a
> single streaming ZIP, under one share link.

## Goal

Today every uploaded file gets its own download link. We want a **transfer** to be the
unit of sharing: one link that may contain 1..N files, where the downloader receives a
**single `.zip`** containing everything — they download one file, unzip locally.

The hard requirement shaping every decision below: **it must run on the Cloudflare Free
plan.**

## The Free-plan constraint that drives the architecture

Free Workers/Pages Functions allow **10 ms of CPU time** and **50 subrequests** per
request. Crucially, CPU time counts *active compute only* — "Waiting on network requests
does not count toward CPU time." This is exactly why the current app can already stream
100 GB single-file downloads on Free: piping R2 bytes to the client is ~0 CPU.

That yields one governing principle:

> **The Worker must never compute over file bytes.**

- Computing a CRC32 in the Worker = active compute over every byte → blows 10 ms on
  anything above a few MB. **Forbidden on Free.**
- Piping bytes the Worker doesn't touch = ~0 CPU → works at 100 GB, as the current
  single-file path already proves.

The ZIP format requires a CRC32 of every member. So the CRC must be produced *off the
Worker*: **computed client-side during upload** and stored, then merely *emitted* (not
recomputed) at download.

This also rules out the obvious library, `client-zip`: it computes CRC32 itself while
streaming (its own docs call CRC "by far the largest performance bottleneck") and offers
no way to inject a precomputed value. Using it would drag per-byte compute back into the
Worker. We hand-roll a minimal encoder instead.

> Note: raising CPU to 5 min (`limits.cpu_ms`) and subrequests to 10,000 is **Workers-only
> and paid**. Pages Functions are fixed at 30 s / (paid) higher subrequests and cannot opt
> in. Since we target Free + Pages, the precompute-CRC design is not an optimisation — it
> is the only viable path. It also has the happy side effect of removing any bundle *size*
> ceiling; only file *count* is capped (by subrequests).

## How it works

### CRC32 precomputed at upload (client-side)

- **Single PUT (≤5 GB):** stream the file through a WASM CRC32 (`hash-wasm`-class,
  ~2–4 GB/s) as/just-before the PUT, so it isn't a second full read.
- **Multipart (>5 GB):** the client already slices into 64 MB parts uploaded 4-at-a-time.
  CRC32 is sequential, which fights parallelism, so each part's CRC is computed as its
  slice is read, then folded in part order with **`crc32_combine`** (order-independent to
  compute, order-dependent to fold). Parallel uploads are preserved.

### Download is pure passthrough

`/d/[id]` runs a **hand-rolled STORE + ZIP64 encoder** (~150 lines): for each member it
emits a local-file header containing the *stored* CRC32 and sizes, then pipes the R2
object's bytes through untouched, and finally writes the central directory (ZIP64 EOCD
when total > 4 GB, any member ≥ 4 GB, or > 65535 entries). No compression, no CRC
recompute → CPU stays near zero, identical to the current single-file path.

Because CRC **and** every size are known upfront, the **total ZIP byte length is
computable**, so the response sets **`Content-Length`** — giving the browser a real
progress bar and ETA (which a CRC-computing streamer cannot).

## Storage layout

```
{id}/manifest.json          # authoritative bundle record (written at finalize)
{id}/{fileId}/{filename}     # one object per member; fileId = short nanoid
```

- `fileId` makes member keys collision-proof (two `report.pdf`s coexist) and keeps the
  filename for the single-file passthrough's `Content-Disposition` and debuggability.
- Members live one level deeper than `manifest.json`, so nothing can collide with the
  reserved manifest key.

**Manifest shape:**

```jsonc
{
  "title": "Q2 assets",            // optional; becomes the zip filename
  "files": [
    { "key": "{id}/{fileId}/report.pdf", "filename": "report.pdf",
      "size": 1048576, "crc32": "1a2b3c4d", "order": 0 }
    // ...
  ]
}
```

## Download dispatch (`/d/[id]`)

`GET {id}/manifest.json`, then:

| Manifest    | Members | Behaviour |
|-------------|---------|-----------|
| Found       | > 1     | Stream ZIP (iterate `files` by `order`, header w/ stored CRC+size, pipe bytes). Name from `title`, fallback `flareshare-{id}.zip`. Set `Content-Length`. |
| Found       | 1       | Stream the single member raw — exactly like today (no pointless single-file zip). |
| **Absent**  | —       | **Legacy fallback**: list the `{id}/` prefix and stream the one object — the *current* code path, verbatim. Existing links keep working, no migration. |

The hot path does **no prefix listing** (the manifest already names every member key,
order, CRC and size) and does **no pre-verify** of members (see Risks).

The encoder lays out every header, offset and the response `Content-Length` from each
member's declared `size`, so `/d/[id]` must feed it the **manifest `size`** — the value
`predictZipSize` was computed from — and never R2's live `Content-Length`. The stored size
is the single source of truth; if it disagreed with the bytes streamed, the zip's offsets
and `Content-Length` would be wrong.

## Upload UX — WeTransfer-style tray

Replaces fire-and-forget per-file upload with a composition tray (1 link per transfer):

- Bundle ID is minted when the first file is added; the client passes that ID to
  `presign-upload` for every file — so `presign-upload` must accept an **existing** bundle
  ID instead of always minting a fresh one.
- **Eager / hybrid uploads:** files upload in the background as they're added (reusing the
  existing presign + `putXhrWithProgress` machinery); CRC32 is computed during that
  upload. **Removing** a file before finalize aborts/deletes its object.
- **"Create link"** waits for any in-flight uploads, then calls `POST /api/finalize-bundle`
  to write the manifest and returns the share link.
- **45-file cap** enforced in the tray (safe headroom under Free's 50 subrequests = 1
  manifest GET + 1 GET per member).
- An **abandoned tray** leaves member objects with no manifest → invisible (no working
  link) and swept by the existing **7-day R2 lifecycle expiry**. A download attempted
  before finalize → 404 / "still processing".

## Surfaces to change

| Area | Change |
|---|---|
| `api/presign-upload` | Accept caller-supplied bundle ID; key = `{id}/{fileId}/{filename}` |
| `api/finalize-bundle` *(new, authed)* | Write `{id}/manifest.json` from client `{filename,size,crc32,order}[]` (+ optional title) |
| `d/[id]` | Manifest-driven dispatch (zip / raw / legacy fallback); set `Content-Length` |
| zip encoder *(new)* | STORE + ZIP64, injects precomputed CRC, byte passthrough |
| `upload/+page.svelte` | Tray UI; WASM CRC32 + `crc32_combine`; finalize call; 45-file cap |
| `upload/+page.server.ts` | Group objects by ID; read manifests for title/file-count |
| `api/delete` | Delete by **bundle ID**: list `{id}/` prefix, remove all members + manifest |

## Decisions on record

- **Download model:** true streaming ZIP (not a bundle landing page). Landing page is a
  possible later add-on.
- **Assembly:** download-time streaming (no pre-generated archive, no second copy in R2,
  no job runner) — preserves the no-database, expiry-only ethos.
- **CRC:** precomputed client-side, stored in the manifest. (R2 native checksum headers
  were considered as an alternative store but not depended on.)
- **Persistence:** per-bundle manifest object (needed anyway for file order + completeness
  signal).
- **Tray:** WeTransfer-style explicit composition with eager background upload.
- **ZIP engine:** hand-rolled STORE + ZIP64 (client-zip rejected — recomputes CRC).
- **CRC for large members:** WASM + `crc32_combine`, so bundle members may exceed 5 GB.
- **Per-bundle file cap:** 45.
- **Member pre-verify at download:** none.
- **Delete:** whole bundle by ID.

## Accepted risks / limits

- **No resume / range** on the zip — a dropped download restarts from zero. Acceptable for
  7-day ephemeral shares.
- **No mid-stream member verification** — if a member is missing after streaming has begun
  (headers + `Content-Length` already sent), the client receives a truncated zip. Rare for
  a finalized bundle, and a whole bundle expires together.
- **45 files per bundle** on Free (size is unbounded; only *count* is capped).
- **Orphan objects** from removed files / abandoned trays, reclaimed by R2 expiry.

## First thing to validate

Before wiring any UI: spike **just** the hand-rolled ZIP64 STORE encoder against a 3-file
fixture and confirm the output round-trips cleanly through **Windows Explorer**, **macOS
Archive Utility**, and **`unzip`**. ZIP64 + data-layout bugs are the highest-risk unknown;
everything else reuses existing, proven machinery.
