<script lang="ts">
  import type { Snippet } from 'svelte'

  let {
    title,
    count,
    tag,
  }: {
    title: string
    count?: string
    tag?: Snippet
  } = $props()
</script>

<div class="section-head">
  <h3 class="section-title mono">
    {title}
    {#if count}<span class="section-count mono dim"> · {count}</span>{/if}
  </h3>
  {#if tag}
    <span class="section-tag mono dim">{@render tag()}</span>
  {/if}
</div>

<style>
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
</style>
