<script lang="ts">
  import SectionHead from '$lib/components/SectionHead.svelte'
  import RecentRow from '$lib/components/RecentRow.svelte'
  import type { TransferRow } from '../../routes/upload/+page.server'

  type RecentItem = TransferRow & { justCopied?: boolean }

  let {
    uploads,
    onDelete,
  }: {
    uploads: RecentItem[]
    onDelete: (item: RecentItem) => void
  } = $props()
</script>

<section class="recent">
  <SectionHead title="Recent transfers">
    {#snippet tag()}{uploads.length} items · auto-purged{/snippet}
  </SectionHead>
  {#if uploads.length === 0}
    <p class="empty mono dim">No transfers yet.</p>
  {:else}
    <ul class="recent-list">
      {#each uploads as r (r.id)}
        <RecentRow item={r} onDelete={() => onDelete(r)} />
      {/each}
    </ul>
  {/if}
</section>

<style>
  .recent-list {
    display: flex;
    flex-direction: column;
  }
  .empty {
    font-size: 12px;
    padding: 12px 4px;
    border-top: 1px solid var(--hairline);
    border-bottom: 1px solid var(--hairline);
  }
</style>
