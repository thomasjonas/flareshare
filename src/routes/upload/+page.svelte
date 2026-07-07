<script lang="ts">
  import { untrack } from 'svelte'
  import { nanoid } from 'nanoid'
  import TopBar from '$lib/components/TopBar.svelte'
  import SiteFooter from '$lib/components/SiteFooter.svelte'
  import DropZone from '$lib/components/DropZone.svelte'
  import UploadTray from '$lib/components/UploadTray.svelte'
  import TransferLink from '$lib/components/TransferLink.svelte'
  import RecentTransfers from '$lib/components/RecentTransfers.svelte'
  import {
    createUploader,
    makeEntry,
    BUNDLE_MAX,
    TOTAL_MAX,
    type FileEntry,
  } from '$lib/upload'
  import type { PageData } from './$types'
  import type { TransferRow } from './+page.server'

  type RecentItem = TransferRow & { justCopied?: boolean }

  let { data }: { data: PageData } = $props()

  // --- Tray state ---
  let files: FileEntry[] = $state([])
  let bundleId: string | null = $state(null)
  let nextOrder = $state(0)
  let title = $state('')
  let recentUploads: RecentItem[] = $state(untrack(() => data.uploads ?? []))

  // --- Finalize state ---
  let finalizing = $state(false)
  let finalizeError = $state('')
  let finalizedUrl = $state('')

  const uploader = createUploader({
    patch: (id, patch) => {
      files = files.map(f => (f.id === id ? { ...f, ...patch } : f))
    },
    getEntry: id => files.find(f => f.id === id),
  })

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
    valid.forEach(e => uploader.upload(e, bId))
  }

  function removeEntry(id: string) {
    const entry = files.find(f => f.id === id)
    if (entry && (entry.status === 'uploading' || entry.status === 'queued')) {
      uploader.abort(entry)
      // For status 'done': the object is already stored in R2. We leave it as an
      // orphan; the existing 14-day R2 lifecycle expiry reclaims it. (Calling
      // /api/delete here would wipe all sibling members under the same bundleId.)
    }
    files = files.filter(f => f.id !== id)
    // Reset bundle state when the tray becomes empty so the next add mints a fresh bundleId
    if (files.length === 0) {
      bundleId = null
      nextOrder = 0
      title = ''
    }
  }

  async function finalizeBundle() {
    const allDone = files.length > 0 && files.every(e => e.status === 'done')
    if (!allDone || finalizing || !bundleId) return

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
</script>

<svelte:head>
  <title>Flareshare — Upload</title>
</svelte:head>

<div class="app">
  <TopBar />

  <main class="view view-upload">
    <DropZone onFiles={addFiles} />

    {#if files.length > 0}
      <UploadTray
        {files}
        bind:title
        {finalizing}
        {finalizeError}
        onRemove={removeEntry}
        onFinalize={finalizeBundle}
      />
    {/if}

    {#if finalizedUrl}
      <TransferLink url={finalizedUrl} onDismiss={() => (finalizedUrl = '')} />
    {/if}

    <RecentTransfers uploads={recentUploads} onDelete={deleteUpload} />
  </main>

  <SiteFooter />
</div>

<style>
  .app {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    color: var(--ink);
  }

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

  @media (max-width: 760px) {
    .view {
      padding: 32px 18px 64px;
      gap: 36px;
    }
  }
</style>
