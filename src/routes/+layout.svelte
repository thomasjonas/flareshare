{@render children()}

<script>
	let { children } = $props();
</script>

<style>
	:global(*), :global(*::before), :global(*::after) {
		box-sizing: border-box;
	}

	:global(:root) {
		--bg: #ffffff;
		--surface: #f4f4f5;
		--border: #e4e4e7;
		--border-focus: #2563eb;
		--text: #18181b;
		--muted: #71717a;
		--accent: #2563eb;
		--accent-hover: #1d4ed8;
		--error: #dc2626;
		--success: #16a34a;
		--radius: 10px;
		--radius-sm: 6px;
		--shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.07), 0 1px 2px rgba(0, 0, 0, 0.04);
	}

	:global(body) {
		margin: 0;
		background: var(--bg);
		color: var(--text);
		font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
		font-size: 15px;
		line-height: 1.5;
		-webkit-font-smoothing: antialiased;
	}

	:global(a) {
		color: var(--accent);
	}

	:global(button) {
		font-family: inherit;
		font-size: inherit;
		cursor: pointer;
	}
</style>
