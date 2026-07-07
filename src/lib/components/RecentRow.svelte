<script lang="ts">
  import IconXButton from '$lib/components/IconXButton.svelte'
  import CopyIcon from '$lib/components/CopyIcon.svelte'
  import { fmt, timeAgo, expiresIn } from '$lib/format'
  import { untrack } from 'svelte'
  import type { TransferRow } from '../../routes/upload/+page.server'

  const COPIED_MS = 1800

  let { item, onDelete }: { item: TransferRow & { justCopied?: boolean }; onDelete: () => void } =
    $props()

  // `justCopied` is a one-time initial hint from the server load, not reactive.
  let copied = $state(untrack(() => item.justCopied ?? false))
  let copyTimer: ReturnType<typeof setTimeout> | null = null

  function copy() {
    navigator.clipboard?.writeText(item.downloadUrl).catch(() => {})
    copied = true
    if (copyTimer) clearTimeout(copyTimer)
    copyTimer = setTimeout(() => {
      copied = false
    }, COPIED_MS)
  }
</script>

<li
  class="rec-row"
  class:is-copied={copied}
>
  <div
    class="rec-name-wrap"
    role="button"
    tabindex="0"
    onclick={copy}
    onkeydown={e => {
      if (e.key === 'Enter' || e.key === ' ') copy()
    }}
  >
    <span class="rec-name mono">{item.title}</span>
    {#if item.kind === 'bundle'}
      <span class="rec-count mono dim">{item.fileCount} file{item.fileCount === 1 ? '' : 's'}</span>
    {/if}

    <span
      class="rec-copy"
      aria-label="Copy link"
    >
      <CopyIcon {copied} />
      {#if copied}
        <span class="rec-copy-label">link copied</span>
      {:else}
        <span class="rec-id mono">{item.id}</span>
      {/if}
    </span>
  </div>
  <span class="rec-size mono dim">{fmt(item.size)}</span>
  <span class="rec-ts mono dim">{timeAgo(item.uploaded)}</span>
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
    {expiresIn(item.uploaded)}
  </span>
  <IconXButton
    class="rec-del mono"
    label="Delete"
    size={22}
    iconSize={10}
    confirmMessage="Delete this transfer? The download link will stop working."
    onclick={onDelete}
  />
</li>

<style>
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
  /* .rec-del is a class handed to the IconXButton child; style it via :global
     scoped under .rec-row so Svelte doesn't strip it as "unused". */
  .rec-row:hover :global(.rec-del) {
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
  .rec-row :global(.rec-del) {
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
  .rec-row :global(.rec-del):hover {
    color: var(--warn);
  }

  @media (max-width: 760px) {
    .rec-row {
      grid-template-columns: 1fr;
      gap: 6px 10px;
      padding: 12px 0;
    }
    .rec-row .rec-size,
    .rec-row .rec-ts,
    .rec-row .rec-exp,
    .rec-row :global(.rec-del) {
      display: none;
    }
  }
</style>
