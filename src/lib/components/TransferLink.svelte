<script lang="ts">
  import SectionHead from '$lib/components/SectionHead.svelte'
  import CopyIcon from '$lib/components/CopyIcon.svelte'

  const COPIED_MS = 1800

  let { url, onDismiss }: { url: string; onDismiss: () => void } = $props()

  let copied = $state(false)
  let copyTimer: ReturnType<typeof setTimeout> | null = null

  function copy() {
    navigator.clipboard?.writeText(url).catch(() => {})
    copied = true
    if (copyTimer) clearTimeout(copyTimer)
    copyTimer = setTimeout(() => {
      copied = false
    }, COPIED_MS)
  }
</script>

<section class="finalize-result">
  <SectionHead title="Transfer link">
    {#snippet tag()}Link ready — share with anyone{/snippet}
  </SectionHead>
  <div
    class="link-row"
    class:link-copied={copied}
    role="button"
    tabindex="0"
    onclick={copy}
    onkeydown={e => {
      if (e.key === 'Enter' || e.key === ' ') copy()
    }}
  >
    <span class="link-url mono">{url}</span>
    <span class="link-copy mono">
      <CopyIcon {copied} />
      {copied ? 'link copied' : 'copy link'}
    </span>
  </div>
  <div class="link-dismiss">
    <button class="dismiss-btn mono" onclick={onDismiss}>Start new transfer</button>
  </div>
</section>

<style>
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
</style>
