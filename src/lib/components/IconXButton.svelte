<script lang="ts">
  let {
    onclick,
    label,
    confirmMessage,
    size = 22,
    iconSize = 11,
    class: className = '',
  }: {
    onclick: () => void
    label: string
    confirmMessage?: string
    size?: number
    iconSize?: number
    class?: string
  } = $props()

  function handleClick() {
    if (confirmMessage && !confirm(confirmMessage)) return
    onclick()
  }
</script>

<button
  class={className}
  style="width:{size}px;height:{size}px"
  onclick={handleClick}
  aria-label={label}
>
  <svg
    width={iconSize}
    height={iconSize}
    viewBox="0 0 13 13"
  >
    <path
      d="M3 3l7 7M10 3l-7 7"
      stroke="currentColor"
      stroke-width="1.2"
    />
  </svg>
</button>
