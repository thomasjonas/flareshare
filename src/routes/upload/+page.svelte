<script lang="ts">
	import { untrack } from 'svelte';
	import type { PageData } from './$types';
	import type { UploadItem } from './+page.server';

	let { data }: { data: PageData } = $props();

	// --- Constants ---
	const SINGLE_PUT_MAX = 5 * 1024 * 1024 * 1024; // 5 GB
	const TOTAL_MAX = 100 * 1024 * 1024 * 1024; // 100 GB
	const PART_SIZE = 64 * 1024 * 1024; // 64 MB
	const CONCURRENCY = 4;
	const MAX_RETRIES = 3;

	// --- Types ---
	type FileStatus = 'queued' | 'uploading' | 'done' | 'error' | 'aborted';

	interface FileEntry {
		id: string;
		file: File;
		status: FileStatus;
		progress: number;
		downloadUrl: string;
		error: string;
		_key?: string;
		_uploadId?: string;
	}

	// --- State ---
	let files: FileEntry[] = $state([]);
	let dragging = $state(false);
	let fileInput: HTMLInputElement;
	let recentUploads: UploadItem[] = $state(untrack(() => data.uploads ?? []));

	// --- Helpers ---
	function makeEntry(file: File): FileEntry {
		return {
			id: Math.random().toString(36).slice(2),
			file,
			status: 'queued',
			progress: 0,
			downloadUrl: '',
			error: ''
		};
	}

	function updateEntry(id: string, patch: Partial<FileEntry>) {
		files = files.map((f) => (f.id === id ? { ...f, ...patch } : f));
	}

	function putXhr(url: string, blob: Blob, contentType: string): Promise<string> {
		return new Promise((resolve, reject) => {
			const xhr = new XMLHttpRequest();
			xhr.open('PUT', url);
			xhr.setRequestHeader('Content-Type', contentType);
			xhr.onload = () => {
				if (xhr.status >= 200 && xhr.status < 300) {
					resolve(xhr.getResponseHeader('ETag') ?? '');
				} else {
					reject(new Error(`PUT ${xhr.status}`));
				}
			};
			xhr.onerror = () => reject(new Error('Network error'));
			xhr.send(blob);
		});
	}

	function putXhrWithProgress(
		url: string,
		blob: Blob,
		contentType: string,
		onProgress: (pct: number) => void
	): Promise<void> {
		return new Promise((resolve, reject) => {
			const xhr = new XMLHttpRequest();
			xhr.open('PUT', url);
			xhr.setRequestHeader('Content-Type', contentType);
			xhr.upload.onprogress = (e) => {
				if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
			};
			xhr.onload = () => {
				if (xhr.status >= 200 && xhr.status < 300) resolve();
				else reject(new Error(`PUT ${xhr.status}`));
			};
			xhr.onerror = () => reject(new Error('Network error'));
			xhr.send(blob);
		});
	}

	async function withRetry<T>(fn: () => Promise<T>, retries = MAX_RETRIES): Promise<T> {
		for (let attempt = 0; attempt < retries; attempt++) {
			try {
				return await fn();
			} catch (err) {
				if (attempt === retries - 1) throw err;
				await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
			}
		}
		throw new Error('unreachable');
	}

	async function uploadSingle(entry: FileEntry) {
		const { file } = entry;
		const res = await fetch('/api/presign-upload', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ filename: file.name, size: file.size, contentType: file.type || 'application/octet-stream' })
		});
		if (!res.ok) throw new Error(`presign-upload: ${await res.text()}`);
		const { id, key, uploadUrl, downloadUrl } = await res.json();

		await putXhrWithProgress(
			uploadUrl,
			file,
			file.type || 'application/octet-stream',
			(pct) => updateEntry(entry.id, { progress: pct })
		);

		updateEntry(entry.id, { status: 'done', progress: 100, downloadUrl });
		recentUploads = [
			{ id, key, filename: file.name, size: file.size, uploaded: new Date().toISOString(), downloadUrl },
			...recentUploads
		];
	}

	async function uploadMultipart(entry: FileEntry) {
		const { file } = entry;
		const partCount = Math.ceil(file.size / PART_SIZE);

		const res = await fetch('/api/presign-multipart', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				filename: file.name,
				size: file.size,
				contentType: file.type || 'application/octet-stream',
				partSize: PART_SIZE,
				partCount
			})
		});
		if (!res.ok) throw new Error(`presign-multipart: ${await res.text()}`);
		const { key, uploadId, parts, downloadUrl } = await res.json();

		updateEntry(entry.id, { _key: key, _uploadId: uploadId });

		const completedParts: { PartNumber: number; ETag: string }[] = [];
		let uploadedBytes = 0;

		const queue = [...parts] as { partNumber: number; url: string; size: number }[];
		const workers = Array.from({ length: CONCURRENCY }, async () => {
			while (queue.length > 0) {
				const part = queue.shift()!;
				const start = (part.partNumber - 1) * PART_SIZE;
				const blob = file.slice(start, start + part.size);

				const etag = await withRetry(() => putXhr(part.url, blob, 'application/octet-stream'));

				completedParts.push({ PartNumber: part.partNumber, ETag: etag.replace(/"/g, '') });
				uploadedBytes += part.size;
				updateEntry(entry.id, { progress: Math.round((uploadedBytes / file.size) * 100) });
			}
		});

		await Promise.all(workers);

		const completeRes = await fetch('/api/complete-multipart', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ key, uploadId, parts: completedParts })
		});
		if (!completeRes.ok) throw new Error(`complete-multipart: ${await completeRes.text()}`);

		updateEntry(entry.id, { status: 'done', progress: 100, downloadUrl });
		const mpId = key.split('/')[0];
		recentUploads = [
			{ id: mpId, key, filename: file.name, size: file.size, uploaded: new Date().toISOString(), downloadUrl },
			...recentUploads
		];
	}

	async function uploadEntry(entry: FileEntry) {
		updateEntry(entry.id, { status: 'uploading', progress: 0 });
		try {
			if (entry.file.size <= SINGLE_PUT_MAX) {
				await uploadSingle(entry);
			} else {
				await uploadMultipart(entry);
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : 'Unknown error';
			updateEntry(entry.id, { status: 'error', error: msg });

			const current = files.find((f) => f.id === entry.id);
			if (current?._key && current?._uploadId) {
				fetch('/api/abort-multipart', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ key: current._key, uploadId: current._uploadId })
				}).catch(() => {});
			}
		}
	}

	function addFiles(incoming: File[]) {
		const valid: FileEntry[] = [];
		for (const f of incoming) {
			if (f.size > TOTAL_MAX) {
				alert(`${f.name} exceeds the 100 GB limit.`);
				continue;
			}
			valid.push(makeEntry(f));
		}
		files = [...files, ...valid];
		valid.forEach((e) => uploadEntry(e));
	}

	function onDragOver(e: DragEvent) {
		e.preventDefault();
		dragging = true;
	}
	function onDragLeave() {
		dragging = false;
	}
	function onDrop(e: DragEvent) {
		e.preventDefault();
		dragging = false;
		const dropped = Array.from(e.dataTransfer?.files ?? []);
		if (dropped.length) addFiles(dropped);
	}
	function onFileInput(e: Event) {
		const target = e.target as HTMLInputElement;
		const chosen = Array.from(target.files ?? []);
		if (chosen.length) addFiles(chosen);
		target.value = '';
	}

	function copyLink(url: string) {
		navigator.clipboard.writeText(url).catch(() => {});
	}

	async function deleteUpload(key: string) {
		if (!confirm('Delete this file? The link will stop working.')) return;
		const res = await fetch('/api/delete', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ key })
		});
		if (res.ok) {
			recentUploads = recentUploads.filter((u) => u.key !== key);
		}
	}

	function fmt(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
		if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
		return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
	}
</script>

<svelte:head>
	<title>Flareshare — Upload</title>
</svelte:head>

<main>
	<header>
		<h1>Flareshare</h1>
		<form method="POST" action="/auth/logout">
			<button type="submit">Sign out</button>
		</form>
	</header>

	<div
		class="zone"
		class:dragging
		ondragover={onDragOver}
		ondragleave={onDragLeave}
		ondrop={onDrop}
		role="region"
		aria-label="File upload area"
	>
		<div class="zone-icon" aria-hidden="true">⬆</div>
		<p>Drag files here, or <button type="button" class="browse-link" onclick={() => fileInput.click()}>browse</button></p>
		<p class="hint">Up to 100 GB per file · Links expire in 7 days</p>
		<input
			bind:this={fileInput}
			type="file"
			multiple
			style="display:none"
			onchange={onFileInput}
		/>
	</div>

	<section class="recent">
		<h2>Recent uploads</h2>
		{#if files.length === 0 && recentUploads.length === 0}
			<p class="hint">No uploads yet.</p>
		{:else}
			<ul class="file-list">
				{#each files as f (f.id)}
					<li class="file-item status-{f.status}">
						<div class="file-meta">
							<span class="file-name">{f.file.name}</span>
							<span class="file-size">{fmt(f.file.size)}</span>
						</div>

						{#if f.status === 'uploading'}
							<div class="progress-bar">
								<div class="progress-fill" style="width:{f.progress}%"></div>
							</div>
							<span class="status-text">{f.progress}%</span>
						{:else if f.status === 'done'}
							<div class="done-row">
								<a href={f.downloadUrl} class="download-link">{f.downloadUrl}</a>
								<button type="button" onclick={() => copyLink(f.downloadUrl)}>Copy</button>
								<span class="expiry">expires in 7 days</span>
							</div>
						{:else if f.status === 'error'}
							<span class="status-text error">{f.error}</span>
						{:else if f.status === 'queued'}
							<span class="status-text">Queued…</span>
						{/if}
					</li>
				{/each}
				{#each recentUploads as u (u.id)}
					<li class="file-item">
						<div class="file-meta">
							<span class="file-name">{u.filename}</span>
							<span class="file-size">{fmt(u.size)}</span>
							<span class="file-date">{new Date(u.uploaded).toLocaleString()}</span>
						</div>
						<div class="done-row">
							<a href={u.downloadUrl} class="download-link">{u.downloadUrl}</a>
							<button type="button" onclick={() => copyLink(u.downloadUrl)}>Copy</button>
							<button type="button" class="delete-btn" onclick={() => deleteUpload(u.key)}>Delete</button>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</main>

<style>
	main {
		max-width: 740px;
		margin: 0 auto;
		padding: 2rem 1.25rem 4rem;
	}

	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 2rem;
		padding-bottom: 1.25rem;
		border-bottom: 1px solid var(--border);
	}

	h1 {
		margin: 0;
		font-size: 1.25rem;
		font-weight: 700;
		letter-spacing: -0.02em;
	}

	header button {
		background: none;
		border: none;
		padding: 0.35rem 0.6rem;
		color: var(--muted);
		font-size: 0.875rem;
		border-radius: var(--radius-sm);
		transition: color 0.15s, background 0.15s;
	}

	header button:hover {
		color: var(--text);
		background: var(--surface);
	}

	/* --- Upload zone --- */
	.zone {
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 3.5rem 1.5rem;
		text-align: center;
		background: var(--surface);
		transition: border-color 0.15s, background 0.15s;
		cursor: default;
	}

	.zone:hover {
		border-color: #a1a1aa;
	}

	.zone.dragging {
		border-color: var(--border-focus);
		background: #eff6ff;
	}

	.zone-icon {
		font-size: 1.75rem;
		margin-bottom: 0.75rem;
		opacity: 0.4;
	}

	.zone p {
		margin: 0;
		color: var(--text);
		font-size: 0.95rem;
	}

	.browse-link {
		background: none;
		border: none;
		padding: 0;
		color: var(--accent);
		text-decoration: underline;
		text-underline-offset: 2px;
		font-size: inherit;
	}

	.browse-link:hover {
		color: var(--accent-hover);
	}

	.hint {
		color: var(--muted);
		font-size: 0.8rem;
		margin: 0.4rem 0 0;
	}

	/* --- File list --- */
	.file-list {
		list-style: none;
		padding: 0;
		margin-top: 1.25rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.file-item {
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 1rem 1.25rem;
		box-shadow: var(--shadow-sm);
		background: var(--bg);
	}

	.file-meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1rem;
		align-items: baseline;
		margin-bottom: 0.5rem;
	}

	.file-name {
		font-weight: 600;
		word-break: break-all;
		font-size: 0.9rem;
	}

	.file-size {
		color: var(--muted);
		font-size: 0.8rem;
		white-space: nowrap;
	}

	.file-date {
		color: var(--muted);
		font-size: 0.78rem;
		white-space: nowrap;
		opacity: 0.8;
	}

	/* --- Progress bar --- */
	.progress-bar {
		height: 8px;
		background: var(--border);
		border-radius: 999px;
		overflow: hidden;
		margin-bottom: 0.35rem;
	}

	.progress-fill {
		height: 100%;
		background: var(--accent);
		transition: width 0.25s ease;
		border-radius: 999px;
	}

	/* --- Status & actions --- */
	.done-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.download-link {
		font-size: 0.82rem;
		color: var(--muted);
		text-decoration: none;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		flex: 1;
	}

	.download-link:hover {
		color: var(--accent);
	}

	.expiry {
		font-size: 0.78rem;
		color: var(--muted);
		opacity: 0.7;
		white-space: nowrap;
	}

	.status-text {
		font-size: 0.82rem;
		color: var(--muted);
	}

	.status-text.error {
		color: var(--error);
	}

	.status-error {
		border-color: #fca5a5;
	}

	.status-done {
		border-color: #86efac;
	}

	/* --- Buttons in done row --- */
	button {
		background: none;
		border: none;
		padding: 0;
	}

	.done-row button {
		font-size: 0.8rem;
		font-weight: 500;
		padding: 0.3rem 0.7rem;
		border-radius: 999px;
		white-space: nowrap;
		transition: background 0.15s, color 0.15s;
	}

	.done-row button:not(.delete-btn) {
		background: var(--accent);
		color: #fff;
	}

	.done-row button:not(.delete-btn):hover {
		background: var(--accent-hover);
	}

	.delete-btn {
		color: var(--muted);
	}

	.delete-btn:hover {
		color: var(--error);
	}

	/* --- Recent section --- */
	.recent {
		margin-top: 2.5rem;
	}

	.recent h2 {
		font-size: 0.7rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--muted);
		margin: 0 0 1rem;
	}
</style>
