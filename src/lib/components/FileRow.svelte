<script lang="ts">
  import IconXButton from '$lib/components/IconXButton.svelte'
  import { fmt, fmtSpeed, fmtEta } from '$lib/format'
  import type { FileEntry } from '$lib/upload'

  let { entry, onRemove }: { entry: FileEntry; onRemove: () => void } = $props()

  let dotClass = $derived(
    entry.status === 'done'
      ? 'on'
      : entry.status === 'error'
        ? 'err'
        : entry.status === 'uploading'
          ? 'live'
          : '',
  )
  let statusLabel = $derived(
    entry.status === 'queued'
      ? 'queued'
      : entry.status === 'uploading'
        ? 'transferring'
        : entry.status === 'done'
          ? 'ready'
          : entry.status === 'error'
            ? 'failed'
            : entry.status,
  )
</script>

<li class="row row-{entry.status}">
  <div class="row-line">
    <div class="row-name">
      <span class="row-dot {dotClass}"></span>
      <span class="row-fname mono">{entry.file.name}</span>
      <span class="row-size mono dim">{fmt(entry.file.size)}</span>
    </div>
    <div class="row-meta mono">
      {#if entry.status === 'uploading'}
        <span>{fmtSpeed(entry.speed)}</span>
        <span class="dot-sep">·</span>
        <span>{fmtEta(entry.eta)}</span>
        <span class="dot-sep">·</span>
        <span class="status-tag">{statusLabel}</span>
      {:else if entry.status === 'queued'}
        <span class="status-tag">{statusLabel}</span>
      {:else if entry.status === 'done'}
        <span class="status-tag ok">{statusLabel}</span>
      {:else if entry.status === 'error'}
        <span class="status-tag err">{statusLabel}</span>
      {/if}
      <IconXButton
        class="row-x"
        label="Remove"
        size={22}
        iconSize={11}
        onclick={onRemove}
      />
    </div>
  </div>

  {#if entry.status === 'uploading'}
    <div class="row-progress">
      <div class="bar">
        <div
          class="bar-fill"
          style="width:{entry.progress}%"
        ></div>
      </div>
      <span class="bar-pct mono">{String(entry.progress).padStart(3, '0')}%</span>
    </div>
  {/if}

  {#if entry.status === 'error'}
    <div class="row-link">
      <span class="mono err-text">! {entry.error}</span>
    </div>
  {/if}
</li>

<style>
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

  @media (max-width: 760px) {
    .row-line {
      flex-direction: column;
      align-items: flex-start;
      gap: 8px;
    }
    .row-meta {
      font-size: 11px;
    }
  }
</style>
