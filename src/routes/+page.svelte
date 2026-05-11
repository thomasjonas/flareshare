<script lang="ts">
	import type { PageData } from './$types';
	export let data: PageData;
</script>

<svelte:head>
	<title>Drop</title>
</svelte:head>

<main>
	<h1>Drop</h1>
	{#if data.user}
		<p><a href="/upload">Go to upload</a></p>
		<form method="POST" action="/auth/logout">
			<button type="submit">Sign out</button>
		</form>
	{:else}
		<p><a href="/auth/login">Log in with GitHub</a></p>
	{/if}
</main>
