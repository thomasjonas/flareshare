<script lang="ts">
  // Swaps between a clipboard glyph and a checkmark based on copied state.
  let { copied = false, size = 12 }: { copied?: boolean; size?: number } = $props()
</script>

{#if copied}
  <svg width={size} height={size} viewBox="0 0 13 13">
    <path
      d="M2.5 7l3 3 5-6"
      stroke="currentColor"
      stroke-width="1.5"
      fill="none"
      stroke-linecap="square"
    />
  </svg>
{:else}
  <svg width={size} height={size} viewBox="0 0 13 13" fill="none">
    <rect x="3.5" y="3.5" width="7" height="7" stroke="currentColor" stroke-width="1.1" />
    <path d="M2 9 V2 H9" stroke="currentColor" stroke-width="1.1" />
  </svg>
{/if}
