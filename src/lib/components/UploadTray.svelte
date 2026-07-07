<script lang="ts">
  import SectionHead from '$lib/components/SectionHead.svelte'
  import FileRow from '$lib/components/FileRow.svelte'
  import { fmt } from '$lib/format'
  import type { FileEntry } from '$lib/upload'

  let {
    files,
    title = $bindable(),
    finalizing,
    finalizeError,
    onRemove,
    onFinalize,
  }: {
    files: FileEntry[]
    title: string
    finalizing: boolean
    finalizeError: string
    onRemove: (id: string) => void
    onFinalize: () => void
  } = $props()

  let activeCount = $derived(
    files.filter(e => e.status === 'uploading' || e.status === 'queued').length,
  )
  let totalBytes = $derived(files.reduce((s, e) => s + e.file.size, 0))
  let sentBytes = $derived(files.reduce((s, e) => s + e.uploadedBytes, 0))
  let hasErrors = $derived(files.some(e => e.status === 'error'))
  let allDone = $derived(files.length > 0 && files.every(e => e.status === 'done'))
  let canFinalize = $derived(allDone && !finalizing)
</script>

<section class="files">
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
        onclick={onFinalize}
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

<style>
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
</style>
