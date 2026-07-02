<script lang="ts">
  import { untrack } from 'svelte'
  import { nanoid } from 'nanoid'
  import { crc32Stream, crc32Combine } from '$lib/crc32'
  import IconXButton from '$lib/components/IconXButton.svelte'
  import type { PageData } from './$types'
  import type { TransferRow } from './+page.server'

  // --- Constants ---
  const SINGLE_PUT_MAX = 5 * 1024 * 1024 * 1024 // 5 GB
  const TOTAL_MAX = 100 * 1024 * 1024 * 1024 // 100 GB
  const PART_SIZE = 64 * 1024 * 1024 // 64 MB
  const CONCURRENCY = 4
  const MAX_RETRIES = 3
  const COPIED_MS = 1800
  const BUNDLE_MAX = 45 // 45-file cap per transfer
  const EXPIRY_DAYS = 14 // matches the R2 lifecycle expiry rule

  // --- Types ---
  type FileStatus = 'queued' | 'uploading' | 'done' | 'error' | 'aborted'

  interface FileEntry {
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

  type RecentItem = TransferRow & { justCopied?: boolean }

  let { data }: { data: PageData } = $props()

  // --- State ---
  let files: FileEntry[] = $state([])
  let bundleId: string | null = $state(null)
  let nextOrder = $state(0)
  let title = $state('')
  let dragging = $state(false)
  let fileInput: HTMLInputElement
  let recentUploads: RecentItem[] = $state(untrack(() => data.uploads ?? []))
  let copiedId: string | null = $state(null)
  let copyTimer: ReturnType<typeof setTimeout> | null = null

  // Map of FileEntry.id → in-flight XHR for single PUTs (enables abort)
  const xhrMap = new Map<string, XMLHttpRequest>()

  // --- Helpers ---
  function makeEntry(file: File, order: number): FileEntry {
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

  function updateEntry(id: string, patch: Partial<FileEntry>) {
    files = files.map(f => (f.id === id ? { ...f, ...patch } : f))
  }

  function fmt(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
    return `${(bytes / 1024 ** 3).toFixed(2)} GB`
  }

  function fmtSpeed(bps: number): string {
    if (!bps || !isFinite(bps)) return '—'
    if (bps < 1024 ** 2) return `${(bps / 1024).toFixed(0)} KB/s`
    if (bps < 1024 ** 3) return `${(bps / 1024 ** 2).toFixed(1)} MB/s`
    return `${(bps / 1024 ** 3).toFixed(2)} GB/s`
  }

  function fmtEta(s: number): string {
    if (!isFinite(s) || isNaN(s)) return '—'
    if (s < 60) return `${Math.ceil(s)}s`
    if (s < 3600) return `${Math.floor(s / 60)}m ${Math.ceil(s % 60)}s`
    return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
  }

  function timeAgo(iso: string): string {
    const t = Date.parse(iso)
    if (isNaN(t)) return ''
    const diff = (Date.now() - t) / 1000
    if (diff < 60) return 'just now'
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
    if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`
    return new Date(t).toLocaleDateString()
  }

  function expiresIn(iso: string): string {
    const t = Date.parse(iso)
    if (isNaN(t)) return `${EXPIRY_DAYS}d 00h`
    const ms = EXPIRY_DAYS * 86400 * 1000 - (Date.now() - t)
    if (ms <= 0) return 'expired'
    const days = Math.floor(ms / 86400000)
    const hours = Math.floor((ms % 86400000) / 3600000)
    return `${days}d ${String(hours).padStart(2, '0')}h`
  }

  // --- Upload helpers ---
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

  function tickProgress(entry: FileEntry, loaded: number, total: number) {
    const now = performance.now()
    const elapsedSec = (now - entry.startedAt) / 1000
    const speed = elapsedSec > 0 ? loaded / elapsedSec : 0
    const remaining = Math.max(0, total - loaded)
    const eta = speed > 0 ? remaining / speed : Infinity
    updateEntry(entry.id, {
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

    // Store key now so removeEntry can abort-multipart if needed (not applicable
    // for single, but harmless; key is also needed for T7 member metadata)
    updateEntry(entry.id, { fileId, key })

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
    updateEntry(entry.id, { status: 'done', progress: 100, crc32 })
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

    updateEntry(entry.id, { fileId, key, _uploadId: uploadId })

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
    updateEntry(entry.id, { status: 'done', progress: 100, crc32 })
  }

  async function uploadEntry(entry: FileEntry, bId: string) {
    updateEntry(entry.id, { status: 'uploading', progress: 0, startedAt: performance.now() })
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
      const current = files.find(f => f.id === entry.id)
      if (current) {
        updateEntry(entry.id, { status: 'error', error: msg })
        // Clean up any orphaned multipart upload server-side
        if (current.key && current._uploadId) {
          fetch('/api/abort-multipart', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: current.key, uploadId: current._uploadId }),
          }).catch(() => {})
        }
      }
    }
  }

  function addFiles(incoming: File[]) {
    // Enforce 45-file cap
    const currentCount = files.length
    if (currentCount >= BUNDLE_MAX) {
      alert(`Transfers are limited to ${BUNDLE_MAX} files. No more files can be added to this transfer.`)
      return
    }
    let filesToAdd = incoming
    if (currentCount + incoming.length > BUNDLE_MAX) {
      const canAdd = BUNDLE_MAX - currentCount
      alert(
        `Transfers are limited to ${BUNDLE_MAX} files. Only the first ${canAdd} file(s) will be added; the rest were skipped.`,
      )
      filesToAdd = incoming.slice(0, canAdd)
    }

    // Mint a fresh bundleId when the first file is added to an empty tray.
    // The same bundleId is reused for every subsequent file in the same tray.
    if (currentCount === 0) {
      bundleId = nanoid(10)
      nextOrder = 0
    }
    const bId = bundleId!

    const valid: FileEntry[] = []
    let orderIdx = nextOrder
    for (const f of filesToAdd) {
      if (f.size > TOTAL_MAX) {
        alert(`${f.name} exceeds the 100 GB limit.`)
        continue
      }
      valid.push(makeEntry(f, orderIdx++))
    }
    nextOrder = orderIdx
    files = [...files, ...valid]
    valid.forEach(e => uploadEntry(e, bId))
  }

  function onDragOver(e: DragEvent) {
    e.preventDefault()
    dragging = true
  }
  function onDragLeave() {
    dragging = false
  }
  function onDrop(e: DragEvent) {
    e.preventDefault()
    dragging = false
    const dropped = Array.from(e.dataTransfer?.files ?? [])
    if (dropped.length) addFiles(dropped)
  }
  function onFileInput(e: Event) {
    const target = e.target as HTMLInputElement
    const chosen = Array.from(target.files ?? [])
    if (chosen.length) addFiles(chosen)
    target.value = ''
  }

  function removeEntry(id: string) {
    const entry = files.find(f => f.id === id)
    if (entry) {
      if (entry.status === 'uploading' || entry.status === 'queued') {
        // Single PUT: abort the in-flight XHR
        xhrMap.get(id)?.abort()
        xhrMap.delete(id)
        // Multipart: abort the server-side multipart upload session
        if (entry.key && entry._uploadId) {
          fetch('/api/abort-multipart', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: entry.key, uploadId: entry._uploadId }),
          }).catch(() => {})
        }
      }
      // For status 'done': the object is already stored in R2.
      // We leave it as an orphan; the existing 14-day R2 lifecycle expiry reclaims it.
      // (Calling /api/delete here would wipe all sibling members under the same bundleId.)
    }
    files = files.filter(f => f.id !== id)
    // Reset bundle state when the tray becomes empty so the next add mints a fresh bundleId
    if (files.length === 0) {
      bundleId = null
      nextOrder = 0
      title = ''
    }
  }

  function copyRecent(item: RecentItem) {
    navigator.clipboard?.writeText(item.downloadUrl).catch(() => {})
    copiedId = item.id
    if (copyTimer) clearTimeout(copyTimer)
    copyTimer = setTimeout(() => {
      copiedId = null
    }, COPIED_MS)
  }

  async function deleteUpload(item: RecentItem) {
    const res = await fetch('/api/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: item.id }),
    })
    if (res.ok) {
      recentUploads = recentUploads.filter(u => u.id !== item.id)
    }
  }

  let activeCount = $derived(
    files.filter(e => e.status === 'uploading' || e.status === 'queued').length,
  )
  let totalBytes = $derived(files.reduce((s, e) => s + e.file.size, 0))
  let sentBytes = $derived(files.reduce((s, e) => s + e.uploadedBytes, 0))
  // --- Finalize state ---
  let finalizing = $state(false)
  let finalizeError = $state('')
  let finalizedUrl = $state('')
  let finalizedCopied = $state(false)
  let finalizedCopyTimer: ReturnType<typeof setTimeout> | null = null

  let hasErrors = $derived(files.some(e => e.status === 'error'))
  let allDone = $derived(files.length > 0 && files.every(e => e.status === 'done'))
  let canFinalize = $derived(allDone && !finalizing)

  async function finalizeBundle() {
    if (!canFinalize || !bundleId) return

    // Check every entry has the required metadata fields
    const missingMeta = files.find(
      e => !e.key || e.crc32 === undefined || e.order === undefined,
    )
    if (missingMeta) {
      finalizeError = `"${missingMeta.file.name}" is missing upload metadata — try removing and re-adding it.`
      return
    }

    finalizing = true
    finalizeError = ''

    const filesSorted = files.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    const filePayload = filesSorted.map(e => ({
      key: e.key!,
      filename: e.file.name,
      size: e.file.size,
      crc32: e.crc32!,
      order: e.order!,
    }))

    try {
      const res = await fetch('/api/finalize-bundle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: bundleId,
          title: title.trim() || undefined,
          files: filePayload,
        }),
      })

      if (res.status === 401) {
        finalizeError = 'Session expired — please sign in again to create a link.'
        return
      }
      if (!res.ok) {
        finalizeError = await res.text()
        return
      }

      const { downloadUrl } = await res.json()
      finalizedUrl = downloadUrl

      // Reset the tray so the next add starts a fresh transfer
      files = []
      bundleId = null
      nextOrder = 0
      title = ''
    } catch (err) {
      finalizeError = err instanceof Error ? err.message : 'Unknown error'
    } finally {
      finalizing = false
    }
  }

  function copyFinalizedUrl() {
    navigator.clipboard?.writeText(finalizedUrl).catch(() => {})
    finalizedCopied = true
    if (finalizedCopyTimer) clearTimeout(finalizedCopyTimer)
    finalizedCopyTimer = setTimeout(() => {
      finalizedCopied = false
    }, COPIED_MS)
  }

  function dismissFinalized() {
    finalizedUrl = ''
    finalizedCopied = false
  }
</script>

<svelte:head>
  <title>Flareshare — Upload</title>
</svelte:head>

<div class="app">
  <header class="topbar">
    <div class="topbar-inner">
      <a
        class="wordmark"
        href="/upload"
        aria-label="Flareshare home"
      >
        <span class="wm-dot"></span>
        <span class="wm-text">Flareshare</span>
      </a>
      <span></span>
      <div class="topright">
        <form
          method="POST"
          action="/auth/logout"
        >
          <button
            type="submit"
            class="logout">Sign out</button
          >
        </form>
      </div>
    </div>
  </header>

  <main class="view view-upload">
    <div
      class="dropzone"
      class:drag={dragging}
      role="button"
      tabindex="0"
      ondragover={onDragOver}
      ondragleave={onDragLeave}
      ondrop={onDrop}
      onclick={() => fileInput.click()}
      onkeydown={e => {
        if (e.key === 'Enter' || e.key === ' ') fileInput.click()
      }}
    >
      <span class="dz-label">
        {#if dragging}
          Release to upload
        {:else}
          Drop files or <span class="u">browse</span>
        {/if}
      </span>
      <span class="dz-specs mono dim">
        <span>up to 45 files · 100 GB each</span>
        <span class="dz-dot">·</span>
        <span>expires in {EXPIRY_DAYS} days</span>
      </span>
      <input
        bind:this={fileInput}
        type="file"
        multiple
        hidden
        onchange={onFileInput}
      />
    </div>

    {#if files.length > 0}
      <section class="files">
        <div class="section-head">
          <h3 class="section-title mono">
            Transferring
            <span class="section-count mono dim"> · {files.length}</span>
          </h3>
          <span class="section-tag mono dim">
            {fmt(sentBytes)} / {fmt(totalBytes)}
            {#if activeCount > 0}
              · <span class="live-dot"></span>{activeCount} active
            {/if}
          </span>
        </div>
        <ul class="file-list">
          {#each files as e (e.id)}
            {@const dotClass =
              e.status === 'done'
                ? 'on'
                : e.status === 'error'
                  ? 'err'
                  : e.status === 'uploading'
                    ? 'live'
                    : ''}
            {@const statusLabel =
              e.status === 'queued'
                ? 'queued'
                : e.status === 'uploading'
                  ? 'transferring'
                  : e.status === 'done'
                    ? 'ready'
                    : e.status === 'error'
                      ? 'failed'
                      : e.status}
            <li class="row row-{e.status}">
              <div class="row-line">
                <div class="row-name">
                  <span class="row-dot {dotClass}"></span>
                  <span class="row-fname mono">{e.file.name}</span>
                  <span class="row-size mono dim">{fmt(e.file.size)}</span>
                </div>
                <div class="row-meta mono">
                  {#if e.status === 'uploading'}
                    <span>{fmtSpeed(e.speed)}</span>
                    <span class="dot-sep">·</span>
                    <span>{fmtEta(e.eta)}</span>
                    <span class="dot-sep">·</span>
                    <span class="status-tag">{statusLabel}</span>
                  {:else if e.status === 'queued'}
                    <span class="status-tag">{statusLabel}</span>
                  {:else if e.status === 'done'}
                    <span class="status-tag ok">{statusLabel}</span>
                  {:else if e.status === 'error'}
                    <span class="status-tag err">{statusLabel}</span>
                  {/if}
                  <IconXButton
                    class="row-x"
                    label="Remove"
                    size={22}
                    iconSize={11}
                    onclick={() => removeEntry(e.id)}
                  />
                </div>
              </div>

              {#if e.status === 'uploading'}
                <div class="row-progress">
                  <div class="bar">
                    <div
                      class="bar-fill"
                      style="width:{e.progress}%"
                    ></div>
                  </div>
                  <span class="bar-pct mono">{String(e.progress).padStart(3, '0')}%</span>
                </div>
              {/if}

              {#if e.status === 'error'}
                <div class="row-link">
                  <span class="mono err-text">! {e.error}</span>
                </div>
              {/if}
            </li>
          {/each}
        </ul>

        <div class="tray-footer">
          <input
            class="title-input mono"
            type="text"
            placeholder="Transfer title (optional)"
            maxlength="200"
            bind:value={title}
          />
          <div class="tray-actions">
            {#if hasErrors}
              <span class="tray-hint mono err-text">Remove failed files to create a link.</span>
            {:else if activeCount > 0}
              <span class="tray-hint mono dim">Waiting for {activeCount} upload{activeCount === 1 ? '' : 's'}…</span>
            {/if}
            <button
              class="create-link-btn mono"
              onclick={finalizeBundle}
              disabled={!canFinalize || hasErrors}
              aria-label="Create transfer link"
            >
              {#if finalizing}
                Creating link…
              {:else if activeCount > 0}
                Uploading…
              {:else}
                Create link
              {/if}
            </button>
          </div>
          {#if finalizeError}
            <div class="tray-error mono">! {finalizeError}</div>
          {/if}
        </div>
      </section>
    {/if}

    {#if finalizedUrl}
      <section class="finalize-result">
        <div class="section-head">
          <h3 class="section-title mono">Transfer link</h3>
          <span class="section-tag mono dim">Link ready — share with anyone</span>
        </div>
        <div
          class="link-row"
          class:link-copied={finalizedCopied}
          role="button"
          tabindex="0"
          onclick={copyFinalizedUrl}
          onkeydown={e => {
            if (e.key === 'Enter' || e.key === ' ') copyFinalizedUrl()
          }}
        >
          <span class="link-url mono">{finalizedUrl}</span>
          <span class="link-copy mono">
            {#if finalizedCopied}
              <svg width="12" height="12" viewBox="0 0 13 13">
                <path
                  d="M2.5 7l3 3 5-6"
                  stroke="currentColor"
                  stroke-width="1.5"
                  fill="none"
                  stroke-linecap="square"
                />
              </svg>
              link copied
            {:else}
              <svg width="12" height="12" viewBox="0 0 13 13" fill="none">
                <rect x="3.5" y="3.5" width="7" height="7" stroke="currentColor" stroke-width="1.1" />
                <path d="M2 9 V2 H9" stroke="currentColor" stroke-width="1.1" />
              </svg>
              copy link
            {/if}
          </span>
        </div>
        <div class="link-dismiss">
          <button class="dismiss-btn mono" onclick={dismissFinalized}>Start new transfer</button>
        </div>
      </section>
    {/if}

    <section class="recent">
      <div class="section-head">
        <h3 class="section-title mono">Recent transfers</h3>
        <span class="section-tag mono dim">
          {recentUploads.length} items · auto-purged
        </span>
      </div>
      {#if recentUploads.length === 0}
        <p class="empty mono dim">No transfers yet.</p>
      {:else}
        <ul class="recent-list">
          {#each recentUploads as r (r.id)}
            {@const isCopied = copiedId === r.id || r.justCopied}
            <li
              class="rec-row"
              class:is-copied={isCopied}
            >
              <div
                class="rec-name-wrap"
                role="button"
                tabindex="0"
                onclick={() => copyRecent(r)}
                onkeydown={e => {
                  if (e.key === 'Enter' || e.key === ' ') copyRecent(r)
                }}
              >
                <span class="rec-name mono">{r.title}</span>
                {#if r.kind === 'bundle'}
                  <span class="rec-count mono dim">{r.fileCount} file{r.fileCount === 1 ? '' : 's'}</span>
                {/if}

                <span
                  class="rec-copy"
                  aria-label="Copy link"
                >
                  {#if isCopied}
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 13 13"
                    >
                      <path
                        d="M2.5 7l3 3 5-6"
                        stroke="currentColor"
                        stroke-width="1.5"
                        fill="none"
                        stroke-linecap="square"
                      />
                    </svg>
                    <span class="rec-copy-label">link copied</span>
                  {:else}
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 13 13"
                      fill="none"
                    >
                      <rect
                        x="3.5"
                        y="3.5"
                        width="7"
                        height="7"
                        stroke="currentColor"
                        stroke-width="1.1"
                      />
                      <path
                        d="M2 9 V2 H9"
                        stroke="currentColor"
                        stroke-width="1.1"
                      />
                    </svg>
                    <span class="rec-id mono">{r.id}</span>
                  {/if}
                </span>
              </div>
              <span class="rec-size mono dim">{fmt(r.size)}</span>
              <span class="rec-ts mono dim">{timeAgo(r.uploaded)}</span>
              <span class="rec-exp mono">
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 12 12"
                  fill="none"
                >
                  <rect
                    x="2.5"
                    y="5.5"
                    width="7"
                    height="5"
                    stroke="currentColor"
                    stroke-width="1.1"
                  />
                  <path
                    d="M4 5.5V4a2 2 0 014 0v1.5"
                    stroke="currentColor"
                    stroke-width="1.1"
                  />
                </svg>
                {expiresIn(r.uploaded)}
              </span>
              <IconXButton
                class="rec-del mono"
                label="Delete"
                size={22}
                iconSize={10}
                confirmMessage="Delete this transfer? The download link will stop working."
                onclick={() => deleteUpload(r)}
              />
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  </main>

  <footer class="footer mono">
    <div class="footer-inner">
      <div class="f-col">
        <span class="dim">© 2026</span>
        <span>Flareshare</span>
        <span class="dim">— personal file transfer</span>
      </div>
    </div>
  </footer>
</div>

<style>
  .app {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    color: var(--ink);
  }

  /* ============ TOPBAR ============ */
  .topbar {
    position: sticky;
    top: 0;
    z-index: 10;
    background: color-mix(in srgb, var(--bg) 92%, transparent);
    backdrop-filter: saturate(140%) blur(8px);
    border-bottom: 1px solid var(--hairline);
  }
  .topbar-inner {
    max-width: 1180px;
    margin: 0 auto;
    padding: 14px 32px;
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 24px;
  }
  .wordmark {
    display: inline-flex;
    align-items: center;
    gap: 9px;
    font-size: 15px;
    letter-spacing: -0.02em;
    font-weight: 600;
  }
  .wm-dot {
    width: 9px;
    height: 9px;
    background: var(--ink);
    border-radius: 50%;
    display: inline-block;
  }
  .wm-text {
    font-feature-settings: 'ss01';
  }
  .topright {
    justify-self: end;
    font-size: 12px;
    color: var(--muted);
    display: inline-flex;
    align-items: center;
    gap: 14px;
    letter-spacing: 0.01em;
  }
  .logout {
    font-size: 12px;
    color: var(--muted);
    letter-spacing: 0.01em;
    transition: color 0.12s;
  }
  .logout:hover {
    color: var(--ink);
  }

  /* ============ VIEW ============ */
  .view {
    max-width: 1180px;
    margin: 0 auto;
    padding: 64px 32px 96px;
    width: 100%;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 56px;
  }

  /* ============ DROPZONE ============ */
  .dropzone {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    border: 1px dashed var(--hairline-strong);
    background: var(--bg);
    padding: 44px 26px;
    cursor: pointer;
    transition:
      background 0.18s,
      border-color 0.18s;
    text-align: center;
  }
  .dropzone:hover {
    border-color: var(--ink);
    background: var(--surface);
  }
  .dropzone.drag {
    border-color: var(--ink);
    border-style: solid;
    background: color-mix(in srgb, var(--ink) 5%, var(--surface));
  }
  .dz-label {
    font-size: 22px;
    letter-spacing: -0.02em;
    color: var(--ink);
    font-weight: 500;
  }
  .dz-label .u {
    font-style: italic;
    font-weight: 400;
    border-bottom: 1.5px solid var(--ink);
    padding-bottom: 1px;
  }
  .dz-specs {
    font-size: 11px;
    letter-spacing: 0.04em;
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .dz-dot {
    color: var(--muted-2);
  }

  /* ============ SECTION HEADS ============ */
  .section-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: 14px;
    gap: 16px;
  }
  .section-title {
    font-size: 11px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ink);
    font-weight: 500;
  }
  .section-count {
    font-weight: 400;
  }
  .section-tag {
    font-size: 11px;
    letter-spacing: 0.04em;
    color: var(--muted);
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .live-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--signal);
    display: inline-block;
    margin-right: 4px;
    animation: drop-pulse 1.4s ease-in-out infinite;
  }

  /* ============ FILE LIST / ROW ============ */
  .file-list {
    display: flex;
    flex-direction: column;
  }
  .row {
    border-top: 1px solid var(--hairline);
    padding: 18px 4px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .row:last-child {
    border-bottom: 1px solid var(--hairline);
  }
  .row-line {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
  }
  .row-name {
    display: flex;
    align-items: baseline;
    gap: 12px;
    min-width: 0;
    flex: 1;
  }
  .row-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--hairline-strong);
    flex-shrink: 0;
    align-self: center;
  }
  .row-dot.live {
    background: var(--accent);
    animation: drop-blink 1.1s ease-in-out infinite;
  }
  .row-dot.on {
    background: var(--signal);
  }
  .row-dot.err {
    background: var(--warn);
  }
  .row-fname {
    font-size: 13.5px;
    color: var(--ink);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    letter-spacing: -0.01em;
  }
  .row-size {
    font-size: 11.5px;
    color: var(--muted);
    flex-shrink: 0;
  }
  .row-meta {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    font-size: 11.5px;
    color: var(--muted);
    flex-shrink: 0;
  }
  .dot-sep {
    color: var(--muted-2);
  }
  .status-tag {
    color: var(--muted);
    padding: 2px 6px;
    border: 1px solid var(--hairline);
    border-radius: 2px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-size: 10px;
  }
  .status-tag.ok {
    color: var(--signal);
    border-color: color-mix(in srgb, var(--signal) 35%, var(--hairline));
  }
  .status-tag.err {
    color: var(--warn);
    border-color: color-mix(in srgb, var(--warn) 40%, var(--hairline));
  }
  .row-x {
    width: 22px;
    height: 22px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--muted-2);
    border-radius: 2px;
    transition:
      color 0.12s,
      background 0.12s;
  }
  .row-x:hover {
    color: var(--ink);
    background: var(--surface);
  }

  .row-progress {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 12px;
    align-items: center;
  }
  .bar {
    height: 3px;
    background: var(--hairline);
    overflow: hidden;
    position: relative;
  }
  .bar-fill {
    height: 100%;
    background: var(--ink);
    transition: width 0.18s linear;
  }
  .bar-pct {
    font-size: 11px;
    color: var(--ink);
    letter-spacing: 0.02em;
    font-variant-numeric: tabular-nums;
    min-width: 36px;
    text-align: right;
  }

  .row-link {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    padding: 9px 12px;
    background: var(--surface);
    border: 1px solid var(--hairline);
    font-size: 12.5px;
  }

  /* ============ TRAY FOOTER (title input + create link) ============ */
  .tray-footer {
    margin-top: 20px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .title-input {
    width: 100%;
    font-size: 12.5px;
    letter-spacing: 0.01em;
    padding: 9px 12px;
    background: var(--bg);
    border: 1px solid var(--hairline);
    color: var(--ink);
    outline: none;
    transition: border-color 0.12s;
    box-sizing: border-box;
  }
  .title-input:focus {
    border-color: var(--ink);
  }
  .title-input::placeholder {
    color: var(--muted-2);
  }
  .tray-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .tray-hint {
    font-size: 11.5px;
    letter-spacing: 0.01em;
    color: var(--muted);
    flex: 1;
  }
  .create-link-btn {
    font-size: 12.5px;
    letter-spacing: 0.03em;
    padding: 9px 20px;
    border: 1px solid var(--ink);
    background: var(--ink);
    color: var(--bg);
    cursor: pointer;
    transition:
      background 0.12s,
      color 0.12s,
      border-color 0.12s;
    flex-shrink: 0;
  }
  .create-link-btn:hover:not(:disabled) {
    background: var(--bg);
    color: var(--ink);
  }
  .create-link-btn:disabled {
    border-color: var(--hairline);
    background: var(--surface);
    color: var(--muted-2);
    cursor: not-allowed;
  }
  .tray-error {
    font-size: 11.5px;
    color: var(--warn);
    padding: 8px 12px;
    border: 1px solid color-mix(in srgb, var(--warn) 40%, var(--hairline));
    background: color-mix(in srgb, var(--warn) 6%, var(--bg));
  }

  /* ============ FINALIZE RESULT ============ */
  .link-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 14px 16px;
    border: 1px solid var(--hairline);
    background: var(--surface);
    cursor: pointer;
    transition:
      border-color 0.12s,
      background 0.12s;
  }
  .link-row:hover {
    border-color: var(--ink);
    background: color-mix(in srgb, var(--ink) 4%, var(--surface));
  }
  .link-row.link-copied {
    border-color: color-mix(in srgb, var(--signal) 40%, var(--hairline));
    background: color-mix(in srgb, var(--signal) 6%, var(--surface));
  }
  .link-url {
    font-size: 13px;
    color: var(--ink);
    letter-spacing: -0.01em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .link-copied .link-url {
    color: var(--signal);
  }
  .link-copy {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    letter-spacing: 0.03em;
    color: var(--muted);
    flex-shrink: 0;
    transition: color 0.12s;
    text-transform: uppercase;
  }
  .link-row:hover .link-copy {
    color: var(--ink);
  }
  .link-row.link-copied .link-copy {
    color: var(--signal);
  }
  .link-dismiss {
    margin-top: 10px;
    display: flex;
    justify-content: flex-end;
  }
  .dismiss-btn {
    font-size: 11.5px;
    letter-spacing: 0.02em;
    color: var(--muted);
    transition: color 0.12s;
  }
  .dismiss-btn:hover {
    color: var(--ink);
  }

  /* ============ RECENT ============ */
  .recent-list {
    display: flex;
    flex-direction: column;
  }
  .rec-row {
    display: grid;
    grid-template-columns: 1fr 90px 110px 100px 24px;
    align-items: center;
    gap: 16px;
    padding: 14px 4px;
    border-top: 1px solid var(--hairline);
    font-size: 12.5px;
  }
  .rec-row:last-child {
    border-bottom: 1px solid var(--hairline);
  }
  .rec-row:hover .rec-del {
    opacity: 1;
  }
  .rec-name-wrap {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    cursor: pointer;
  }
  .rec-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
    color: var(--ink);
    transition: color 0.12s;
    font-size: 12.5px;
  }
  .rec-count {
    font-size: 11px;
    letter-spacing: 0.03em;
    color: var(--muted);
    flex-shrink: 0;
    padding: 1px 5px;
    border: 1px solid var(--hairline);
    border-radius: 2px;
  }
  .rec-id {
    opacity: 0;
    transition: opacity 0.12s;
    color: var(--muted) !important;
  }
  .rec-copy {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--muted-2);
    flex-shrink: 0;
    font-size: 11px;
    letter-spacing: 0.02em;
    transition: color 0.12s;
  }
  .rec-copy-label {
    font-family: 'Geist Mono', ui-monospace, monospace;
  }
  .rec-name-wrap:hover .rec-name {
    color: var(--accent);
  }
  .rec-name-wrap:hover .rec-copy {
    color: var(--accent);
  }
  .rec-name-wrap:hover .rec-id {
    opacity: 1;
  }
  .rec-row.is-copied .rec-name {
    color: var(--signal);
  }
  .rec-row.is-copied .rec-copy {
    color: var(--signal);
  }
  .rec-size,
  .rec-ts {
    font-size: 11.5px;
  }
  .rec-exp {
    font-size: 11px;
    color: var(--muted);
    display: inline-flex;
    align-items: center;
    gap: 6px;
    justify-self: end;
  }
  .rec-del {
    width: 22px;
    height: 22px;
    color: var(--muted-2);
    opacity: 0;
    justify-self: end;
    transition:
      opacity 0.12s,
      color 0.12s;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .rec-del:hover {
    color: var(--warn);
  }
  .empty {
    font-size: 12px;
    padding: 12px 4px;
    border-top: 1px solid var(--hairline);
    border-bottom: 1px solid var(--hairline);
  }

  /* ============ FOOTER ============ */
  .footer {
    border-top: 1px solid var(--hairline);
    padding: 18px 0;
    margin-top: auto;
  }
  .footer-inner {
    max-width: 1180px;
    margin: 0 auto;
    padding: 0 32px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 11.5px;
    color: var(--muted);
    gap: 16px;
    flex-wrap: wrap;
  }
  .f-col {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }

  /* ============ RESPONSIVE ============ */
  @media (max-width: 760px) {
    .topbar-inner {
      grid-template-columns: 1fr auto;
      padding: 12px 18px;
    }
    .view {
      padding: 32px 18px 64px;
      gap: 36px;
    }
    .dropzone {
      padding: 18px 16px;
      gap: 12px;
    }
    .dz-label {
      font-size: 15px;
    }
    .metastrip {
      grid-template-columns: repeat(2, 1fr);
    }
    .meta:nth-child(2) {
      border-right: none;
    }
    .meta:nth-child(-n + 2) {
      border-bottom: 1px solid var(--hairline);
    }
    .row-line {
      flex-direction: column;
      align-items: flex-start;
      gap: 8px;
    }
    .row-meta {
      font-size: 11px;
    }
    .rec-row {
      grid-template-columns: 1fr;
      gap: 6px 10px;
      padding: 12px 0;
    }
    .rec-row .rec-size,
    .rec-row .rec-ts,
    .rec-row .rec-exp,
    .rec-row .rec-del {
      display: none;
    }
    .footer-inner {
      padding: 0 18px;
    }
  }
</style>
