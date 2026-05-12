<script>
	let { children } = $props();
</script>

{@render children()}

<style>
	:global(*),
	:global(*::before),
	:global(*::after) {
		box-sizing: border-box;
	}

	:global(:root) {
		--bg: #fafaf7;
		--surface: #f2f1ec;
		--hairline: #e2e1db;
		--hairline-strong: #c9c7be;
		--ink: #0e0e0c;
		--ink-2: #2a2a26;
		--muted: #6e6d66;
		--muted-2: #9b9a92;
		--accent: #0e0e0c;
		--accent-fg: #fafaf7;
		--signal: oklch(58% 0.14 145);
		--warn: oklch(60% 0.16 30);
		--radius: 2px;
	}

	:global(html),
	:global(body) {
		margin: 0;
		padding: 0;
	}

	:global(body) {
		font-family: 'Geist', ui-sans-serif, system-ui, sans-serif;
		background: var(--bg);
		color: var(--ink);
		font-size: 15px;
		line-height: 1.5;
		-webkit-font-smoothing: antialiased;
		-moz-osx-font-smoothing: grayscale;
		font-feature-settings: 'ss01', 'cv11';
	}

	:global(.mono) {
		font-family: 'Geist Mono', ui-monospace, monospace;
		font-feature-settings: 'zero', 'ss01';
	}

	:global(::selection) {
		background: var(--ink);
		color: var(--bg);
	}

	:global(button) {
		font-family: inherit;
		cursor: pointer;
		border: none;
		background: none;
		padding: 0;
		color: inherit;
	}

	:global(a) {
		color: inherit;
		text-decoration: none;
	}

	:global(ul) {
		list-style: none;
		padding: 0;
		margin: 0;
	}

	:global(h1),
	:global(h2),
	:global(h3),
	:global(h4),
	:global(p),
	:global(dl),
	:global(dd),
	:global(dt) {
		margin: 0;
		padding: 0;
	}

	:global(code) {
		font-family: 'Geist Mono', ui-monospace, monospace;
	}

	:global(.dim) {
		color: var(--muted);
	}

	:global(.err-text) {
		color: var(--warn);
	}

	@keyframes -global-drop-pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.35;
		}
	}

	@keyframes -global-drop-blink {
		50% {
			opacity: 0.15;
		}
	}
</style>
