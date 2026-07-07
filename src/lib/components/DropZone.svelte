<script lang="ts">
  import { EXPIRY_DAYS } from '$lib/format'

  let { onFiles }: { onFiles: (files: File[]) => void } = $props()

  let dragging = $state(false)
  let fileInput: HTMLInputElement

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
</script>

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

<style>
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

  @media (max-width: 760px) {
    .dropzone {
      padding: 18px 16px;
      gap: 12px;
    }
    .dz-label {
      font-size: 15px;
    }
  }
</style>
