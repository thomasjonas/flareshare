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
  import { createReconciler } from '$lib/reconcile'
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

  // --- Reconcile state ---
  // The link is a pure consequence of the well settling — never a manual
  // commit. `sealed`/`downloadUrl` reflect the last reconcile write that
  // actually completed; see docs/adr/0002-sealed-manifest-lifecycle.md.
  let sealed = $state(false)
  let downloadUrl = $state('')
  let reconcileError = $state('')

  const uploader = createUploader({
    patch: (id, patch) => {
      files = files.map(f => (f.id === id ? { ...f, ...patch } : f))
      reconciler.schedule()
    },
    getEntry: id => files.find(f => f.id === id),
  })

  const reconciler = createReconciler({
    getState: () => ({ bundleId, title, files }),
    write: async (bId, t, members, isSealed) => {
      const filesSorted = members.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      const missingMeta = filesSorted.find(
        e => !e.key || e.crc32 === undefined || e.order === undefined,
      )
      if (missingMeta) {
        reconcileError = `"${missingMeta.file.name}" is missing upload metadata — try removing and re-adding it.`
        return
      }
      const filePayload = filesSorted.map(e => ({
        key: e.key!,
        filename: e.file.name,
        size: e.file.size,
        crc32: e.crc32!,
        order: e.order!,
      }))

      const res = await fetch('/api/finalize-bundle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: bId,
          title: t.trim() || undefined,
          sealed: isSealed,
          files: filePayload,
        }),
      })

      if (res.status === 401) {
        reconcileError = 'Session expired — please sign in again.'
        return
      }
      if (!res.ok) {
        reconcileError = await res.text()
        return
      }

      reconcileError = ''
      const { downloadUrl: url } = await res.json()
      downloadUrl = url
      sealed = isSealed
    },
    del: async bId => {
      await fetch('/api/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: bId }),
      })
      // Only clear bundle identity once the delete has actually completed —
      // see the comment in addFiles for the race this avoids.
      if (bundleId === bId) {
        bundleId = null
        nextOrder = 0
        title = ''
      }
      downloadUrl = ''
      sealed = false
    },
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

    // Mint a fresh bundleId only when there is no bundle currently in play.
    // Deliberately keyed on `bundleId`, not `files.length`: emptying the well
    // schedules a debounced delete of the *old* bundleId (see reconciler's
    // `del`), which only clears `bundleId` once that delete actually
    // completes. If the sender re-adds a file before that fires, we want to
    // keep uploading into the same (soon-to-not-be-deleted) bundle rather
    // than mint a second one and race the pending delete against it.
    if (bundleId === null) {
      bundleId = nanoid(10)
    }
    const bId = bundleId

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
    reconciler.schedule()
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
    // Bundle/title reset (when the well ends up empty) happens inside the
    // reconciler's `del` callback, once the delete actually completes — not
    // here. See the comment in addFiles for why.
    reconciler.schedule()
  }

  /** "Start new transfer": the current transfer stays live/shared as-is; only
   * the local tray resets so the next add begins a fresh bundle. */
  function startNewTransfer() {
    files = []
    bundleId = null
    nextOrder = 0
    title = ''
    downloadUrl = ''
    sealed = false
  }

  // Renaming (title change) also reconciles — debounced, same as file
  // changes — so a sealed manifest's title stays current without unsealing
  // (sealed depends only on file status, never on title).
  $effect(() => {
    title
    reconciler.schedule()
  })

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
      <UploadTray {files} bind:title error={reconcileError} onRemove={removeEntry} />
    {/if}

    {#if sealed && downloadUrl}
      <TransferLink url={downloadUrl} onDismiss={startNewTransfer} />
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
