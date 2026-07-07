<script lang="ts">
  import SectionHead from '$lib/components/SectionHead.svelte'
  import FileRow from '$lib/components/FileRow.svelte'
  import CopyIcon from '$lib/components/CopyIcon.svelte'
  import { fmt, EXPIRY_DAYS } from '$lib/format'
  import { computeWellDisplay } from '$lib/well'
  import type { FileEntry } from '$lib/upload'

  const COPIED_MS = 1800

  let {
    files,
    title = $bindable(),
    downloadUrl,
    error,
    onFiles,
    onRemove,
    onStartNew,
  }: {
    files: FileEntry[]
    title: string
    downloadUrl: string
    error: string
    onFiles: (files: File[]) => void
    onRemove: (id: string) => void
    onStartNew: () => void
  } = $props()

  let display = $derived(computeWellDisplay(files, downloadUrl !== ''))

  let dragging = $state(false)
  let fileInput: HTMLInputElement
  let copied = $state(false)
  let copyTimer: ReturnType<typeof setTimeout> | null = null

  let activeCount = $derived(
    files.filter(e => e.status === 'uploading' || e.status === 'queued').length,
  )
  let totalBytes = $derived(files.reduce((s, e) => s + e.file.size, 0))
  let sentBytes = $derived(files.reduce((s, e) => s + e.uploadedBytes, 0))
  let hasErrors = $derived(files.some(e => e.status === 'error'))

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
    if (dropped.length) onFiles(dropped)
  }
  function onFileInput(e: Event) {
    const target = e.target as HTMLInputElement
    const chosen = Array.from(target.files ?? [])
    if (chosen.length) onFiles(chosen)
    target.value = ''
  }
  function browse() {
    fileInput.click()
  }

  function copyLink() {
    navigator.clipboard?.writeText(downloadUrl).catch(() => {})
    copied = true
    if (copyTimer) clearTimeout(copyTimer)
    copyTimer = setTimeout(() => {
      copied = false
    }, COPIED_MS)
  }
</script>

<div
  class="well"
  class:drag={dragging}
  class:well-empty={display.mode === 'empty'}
  role="group"
  aria-label="Current transfer"
  ondragover={onDragOver}
  ondragleave={onDragLeave}
  ondrop={onDrop}
>
  {#if display.mode === 'empty'}
    <div
      class="dropzone"
      role="button"
      tabindex="0"
      onclick={browse}
      onkeydown={e => {
        if (e.key === 'Enter' || e.key === ' ') browse()
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
    </div>
  {:else}
    <SectionHead title="Transferring" count={String(files.length)}>
      {#snippet tag()}
        {fmt(sentBytes)} / {fmt(totalBytes)}
        {#if activeCount > 0}
          · <span class="live-dot"></span>{activeCount} active
        {/if}
      {/snippet}
    </SectionHead>

    <ul class="file-list">
      {#each files as e (e.id)}
        <FileRow entry={e} onRemove={() => onRemove(e.id)} />
      {/each}
    </ul>

    <div class="well-footer">
      {#if display.mode === 'working'}
        <div class="well-status">
          {#if hasErrors}
            <span class="well-hint mono err-text">Remove failed files to seal the transfer.</span>
          {:else}
            <span class="well-hint mono dim">Preparing link…</span>
          {/if}
        </div>
      {:else}
        <div
          class="link-row"
          class:link-copied={copied}
          role="button"
          tabindex="0"
          onclick={copyLink}
          onkeydown={e => {
            if (e.key === 'Enter' || e.key === ' ') copyLink()
          }}
        >
          <span class="link-url mono">{downloadUrl}</span>
          <span class="link-copy mono">
            <CopyIcon {copied} />
            {copied ? 'link copied' : 'copy link'}
          </span>
        </div>
        {#if display.updating}
          <span class="well-hint mono dim updating"><span class="live-dot"></span>updating…</span>
        {/if}

        <input
          class="title-input mono"
          type="text"
          placeholder="Transfer title (optional)"
          maxlength="200"
          bind:value={title}
        />

        <div class="well-actions">
          <button class="ghost-btn mono" onclick={browse}>+ Add files</button>
          <button class="dismiss-btn mono" onclick={onStartNew}>Start new transfer</button>
        </div>
      {/if}
      {#if error}
        <div class="well-error mono">! {error}</div>
      {/if}
    </div>
  {/if}

  <input bind:this={fileInput} type="file" multiple hidden onchange={onFileInput} />
</div>

<style>
  .well {
    position: relative;
    transition:
      background 0.18s,
      border-color 0.18s;
  }
  .well.drag {
    outline: 1px solid var(--ink);
    outline-offset: 4px;
  }

  /* --- Empty state (drop zone) --- */
  .well-empty {
    border: 1px dashed var(--hairline-strong);
    background: var(--bg);
  }
  .dropzone {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 44px 26px;
    cursor: pointer;
    text-align: center;
    transition:
      background 0.18s,
      border-color 0.18s;
  }
  .well-empty:hover,
  .well-empty.drag {
    border-color: var(--ink);
    background: var(--surface);
  }
  .well-empty.drag {
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

  /* --- Working / sealed states --- */
  .live-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--signal);
    display: inline-block;
    margin-right: 4px;
    animation: drop-pulse 1.4s ease-in-out infinite;
  }
  .file-list {
    display: flex;
    flex-direction: column;
  }

  .well-footer {
    margin-top: 20px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .well-status {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .well-hint {
    font-size: 11.5px;
    letter-spacing: 0.01em;
    color: var(--muted);
  }
  .well-hint.updating {
    display: inline-flex;
    align-items: center;
  }
  .well-error {
    font-size: 11.5px;
    color: var(--warn);
    padding: 8px 12px;
    border: 1px solid color-mix(in srgb, var(--warn) 40%, var(--hairline));
    background: color-mix(in srgb, var(--warn) 6%, var(--bg));
  }

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

  .well-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .ghost-btn {
    font-size: 11.5px;
    letter-spacing: 0.02em;
    color: var(--muted);
    padding: 6px 10px;
    border: 1px solid var(--hairline);
    transition:
      color 0.12s,
      border-color 0.12s;
  }
  .ghost-btn:hover {
    color: var(--ink);
    border-color: var(--ink);
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

  @media (max-width: 760px) {
    .well-empty .dropzone {
      padding: 18px 16px;
      gap: 12px;
    }
    .dz-label {
      font-size: 15px;
    }
  }
</style>
