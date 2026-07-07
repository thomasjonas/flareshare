// Client-side upload engine: presign → PUT (single or multipart) → CRC32.
// UI-agnostic; talks to the component only through the injected callbacks.

import { crc32Stream, crc32Combine } from '$lib/crc32'

// --- Constants ---
export const SINGLE_PUT_MAX = 5 * 1024 * 1024 * 1024 // 5 GB
export const TOTAL_MAX = 100 * 1024 * 1024 * 1024 // 100 GB
export const PART_SIZE = 64 * 1024 * 1024 // 64 MB
export const CONCURRENCY = 4
export const MAX_RETRIES = 3
export const BUNDLE_MAX = 45 // 45-file cap per transfer

// --- Types ---
export type FileStatus = 'queued' | 'uploading' | 'done' | 'error' | 'aborted'

export interface FileEntry {
  id: string
  file: File
  status: FileStatus
  progress: number
  error: string
  startedAt: number
  uploadedBytes: number
  speed: number // bytes/sec
  eta: number // seconds
  // Bundle member metadata (populated after presign / on completion)
  fileId?: string
  key?: string
  crc32?: string
  order?: number
  // Multipart abort tracking
  _uploadId?: string
}

export function makeEntry(file: File, order: number): FileEntry {
  return {
    id: Math.random().toString(36).slice(2),
    file,
    status: 'queued',
    progress: 0,
    error: '',
    startedAt: 0,
    uploadedBytes: 0,
    speed: 0,
    eta: Infinity,
    order,
  }
}

// --- Low-level XHR helpers ---
function putXhr(url: string, blob: Blob, contentType: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    xhr.setRequestHeader('Content-Type', contentType)
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.getResponseHeader('ETag') ?? '')
      } else {
        reject(new Error(`PUT ${xhr.status}`))
      }
    }
    xhr.onerror = () => reject(new Error('Network error'))
    xhr.send(blob)
  })
}

function putXhrWithProgress(
  url: string,
  blob: Blob,
  contentType: string,
  onProgress: (loaded: number) => void,
  onXhr?: (xhr: XMLHttpRequest) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    xhr.setRequestHeader('Content-Type', contentType)
    xhr.upload.onprogress = e => {
      if (e.lengthComputable) onProgress(e.loaded)
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve()
      else reject(new Error(`PUT ${xhr.status}`))
    }
    xhr.onerror = () => reject(new Error('Network error'))
    xhr.onabort = () => reject(new Error('Upload aborted'))
    onXhr?.(xhr)
    xhr.send(blob)
  })
}

async function withRetry<T>(fn: () => Promise<T>, retries = MAX_RETRIES): Promise<T> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (attempt === retries - 1) throw err
      await new Promise(r => setTimeout(r, 500 * 2 ** attempt))
    }
  }
  throw new Error('unreachable')
}

function abortMultipart(key: string, uploadId: string) {
  fetch('/api/abort-multipart', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, uploadId }),
  }).catch(() => {})
}

export interface UploaderCallbacks {
  /** Merge a partial patch into the entry with the given id. */
  patch: (id: string, patch: Partial<FileEntry>) => void
  /** Look up the current entry (returns undefined if it was removed from the tray). */
  getEntry: (id: string) => FileEntry | undefined
}

/**
 * Create an uploader bound to a component's entry store. Owns the in-flight
 * XHR map so aborts (via removeEntry) can cancel running single PUTs.
 */
export function createUploader({ patch, getEntry }: UploaderCallbacks) {
  // Map of FileEntry.id → in-flight XHR for single PUTs (enables abort)
  const xhrMap = new Map<string, XMLHttpRequest>()

  function tickProgress(entry: FileEntry, loaded: number, total: number) {
    const now = performance.now()
    const elapsedSec = (now - entry.startedAt) / 1000
    const speed = elapsedSec > 0 ? loaded / elapsedSec : 0
    const remaining = Math.max(0, total - loaded)
    const eta = speed > 0 ? remaining / speed : Infinity
    patch(entry.id, {
      progress: Math.round((loaded / total) * 100),
      uploadedBytes: loaded,
      speed,
      eta,
    })
  }

  async function uploadSingle(entry: FileEntry, bId: string) {
    const { file } = entry
    const ct = file.type || 'application/octet-stream'

    const res = await fetch('/api/presign-upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bundleId: bId,
        filename: file.name,
        size: file.size,
        contentType: ct,
      }),
    })
    if (!res.ok) throw new Error(`presign-upload: ${await res.text()}`)
    const { fileId, key, uploadUrl } = await res.json()

    // Store key now for T7 member metadata (single PUTs have nothing to abort).
    patch(entry.id, { fileId, key })

    // Run upload and CRC32 in parallel — Blob supports multiple independent readers
    const [, crc32] = await Promise.all([
      putXhrWithProgress(
        uploadUrl,
        file,
        ct,
        loaded => tickProgress(entry, loaded, file.size),
        xhr => xhrMap.set(entry.id, xhr),
      ),
      crc32Stream(file),
    ])
    xhrMap.delete(entry.id)

    // Stay in tray (status 'done') so T7 can gather member metadata
    patch(entry.id, { status: 'done', progress: 100, crc32 })
  }

  async function uploadMultipart(entry: FileEntry, bId: string) {
    const { file } = entry
    const ct = file.type || 'application/octet-stream'
    const partCount = Math.ceil(file.size / PART_SIZE)

    const res = await fetch('/api/presign-multipart', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bundleId: bId,
        filename: file.name,
        size: file.size,
        contentType: ct,
        partSize: PART_SIZE,
        partCount,
      }),
    })
    if (!res.ok) throw new Error(`presign-multipart: ${await res.text()}`)
    const { fileId, key, uploadId, parts } = await res.json()

    patch(entry.id, { fileId, key, _uploadId: uploadId })

    const completedParts: { PartNumber: number; ETag: string }[] = []
    // Keyed by partNumber; populated as parts complete (out of order within workers)
    const partCrcs = new Map<number, { crc: string; size: number }>()
    let uploadedBytes = 0

    const queue = [...parts] as { partNumber: number; url: string; size: number }[]
    const workers = Array.from({ length: CONCURRENCY }, async () => {
      while (queue.length > 0) {
        const part = queue.shift()!
        const start = (part.partNumber - 1) * PART_SIZE
        const blob = file.slice(start, start + part.size)
        // Upload + per-part CRC32 in parallel
        const [etag, partCrc] = await Promise.all([
          withRetry(() => putXhr(part.url, blob, 'application/octet-stream')),
          crc32Stream(blob),
        ])
        completedParts.push({ PartNumber: part.partNumber, ETag: etag.replace(/"/g, '') })
        partCrcs.set(part.partNumber, { crc: partCrc, size: part.size })
        uploadedBytes += part.size
        tickProgress(entry, uploadedBytes, file.size)
      }
    })
    await Promise.all(workers)

    // Fold part CRCs in ascending partNumber order.
    // crc32Combine('00000000', c, len) === c, so starting from all-zeros is correct.
    const sortedParts = (parts as { partNumber: number; size: number }[]).slice().sort(
      (a, b) => a.partNumber - b.partNumber,
    )
    let crc32 = '00000000'
    for (const { partNumber, size } of sortedParts) {
      const info = partCrcs.get(partNumber)!
      crc32 = crc32Combine(crc32, info.crc, size)
    }

    const completeRes = await fetch('/api/complete-multipart', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, uploadId, parts: completedParts }),
    })
    if (!completeRes.ok) throw new Error(`complete-multipart: ${await completeRes.text()}`)

    // Stay in tray (status 'done') so T7 can gather member metadata
    patch(entry.id, { status: 'done', progress: 100, crc32 })
  }

  async function upload(entry: FileEntry, bId: string) {
    patch(entry.id, { status: 'uploading', progress: 0, startedAt: performance.now() })
    try {
      if (entry.file.size <= SINGLE_PUT_MAX) {
        await uploadSingle(entry, bId)
      } else {
        await uploadMultipart(entry, bId)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      xhrMap.delete(entry.id)

      // Only update error state if the entry is still in the tray (not removed)
      const current = getEntry(entry.id)
      if (current) {
        patch(entry.id, { status: 'error', error: msg })
        // Clean up any orphaned multipart upload server-side
        if (current.key && current._uploadId) {
          abortMultipart(current.key, current._uploadId)
        }
      }
    }
  }

  /**
   * Cancel an in-flight upload for a removed entry: abort the single PUT XHR
   * and/or tear down the server-side multipart session.
   */
  function abort(entry: FileEntry) {
    xhrMap.get(entry.id)?.abort()
    xhrMap.delete(entry.id)
    if (entry.key && entry._uploadId) {
      abortMultipart(entry.key, entry._uploadId)
    }
  }

  return { upload, abort }
}
