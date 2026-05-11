<script lang="ts">
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
		progress: number; // 0–100
		downloadUrl: string;
		error: string;
		// multipart state for abort on cancel
		_key?: string;
		_uploadId?: string;
	}

	// --- State ---
	let files: FileEntry[] = [];
	let dragging = false;
	let fileInput: HTMLInputElement;

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

	// Upload a file ≤5 GB with a single presigned PUT + progress tracking.
	async function uploadSingle(entry: FileEntry) {
		const { file } = entry;
		const res = await fetch('/api/presign-upload', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ filename: file.name, size: file.size, contentType: file.type || 'application/octet-stream' })
		});
		if (!res.ok) throw new Error(`presign-upload: ${await res.text()}`);
		const { uploadUrl, downloadUrl } = await res.json();

		await putXhrWithProgress(
			uploadUrl,
			file,
			file.type || 'application/octet-stream',
			(pct) => updateEntry(entry.id, { progress: pct })
		);

		updateEntry(entry.id, { status: 'done', progress: 100, downloadUrl });
	}

	// Upload a file >5 GB using multipart with concurrent part uploads.
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

		// Process parts with a concurrency pool.
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

			// Best-effort abort if multipart was initiated.
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

	// Drag-and-drop handlers
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

	function fmt(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
		if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
		return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
	}
</script>

<svelte:head>
	<title>Drop — Upload</title>
</svelte:head>

<main>
	<header>
		<h1>Drop</h1>
		<form method="POST" action="/auth/logout">
			<button type="submit">Sign out</button>
		</form>
	</header>

	<!-- svelte-ignore a11y-no-static-element-interactions -->
	<div
		class="zone"
		class:dragging
		on:dragover={onDragOver}
		on:dragleave={onDragLeave}
		on:drop={onDrop}
	>
		<p>Drag files here, or <button type="button" on:click={() => fileInput.click()}>browse</button></p>
		<p class="hint">Up to 100 GB per file · Links expire in 7 days</p>
		<input
			bind:this={fileInput}
			type="file"
			multiple
			style="display:none"
			on:change={onFileInput}
		/>
	</div>

	{#if files.length > 0}
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
							<button type="button" on:click={() => copyLink(f.downloadUrl)}>Copy</button>
							<span class="expiry">expires in 7 days</span>
						</div>
					{:else if f.status === 'error'}
						<span class="status-text error">{f.error}</span>
					{:else if f.status === 'queued'}
						<span class="status-text">Queued…</span>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</main>

<style>
	main {
		max-width: 720px;
		margin: 2rem auto;
		padding: 0 1rem;
		font-family: system-ui, sans-serif;
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 1.5rem;
	}
	h1 { margin: 0; }

	.zone {
		border: 2px dashed #ccc;
		border-radius: 8px;
		padding: 2.5rem 1rem;
		text-align: center;
		transition: border-color 0.15s, background 0.15s;
		cursor: default;
	}
	.zone.dragging {
		border-color: #0066ff;
		background: #f0f6ff;
	}
	.hint { color: #888; font-size: 0.85rem; margin: 0.25rem 0 0; }

	.file-list { list-style: none; padding: 0; margin-top: 1.5rem; }
	.file-item {
		border: 1px solid #e0e0e0;
		border-radius: 6px;
		padding: 0.75rem 1rem;
		margin-bottom: 0.5rem;
	}
	.file-meta { display: flex; gap: 1rem; align-items: baseline; margin-bottom: 0.4rem; }
	.file-name { font-weight: 500; word-break: break-all; }
	.file-size { color: #888; font-size: 0.85rem; white-space: nowrap; }

	.progress-bar {
		height: 6px;
		background: #eee;
		border-radius: 3px;
		overflow: hidden;
		margin-bottom: 0.25rem;
	}
	.progress-fill { height: 100%; background: #0066ff; transition: width 0.2s; }

	.done-row { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
	.download-link { font-size: 0.85rem; word-break: break-all; }
	.expiry { font-size: 0.8rem; color: #888; }

	.status-text { font-size: 0.85rem; color: #555; }
	.status-text.error { color: #c00; }
	.status-done { border-color: #4caf50; }
	.status-error { border-color: #f44336; }
</style>
