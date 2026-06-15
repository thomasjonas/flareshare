import { AwsClient } from 'aws4fetch';

export function makeClient(env: App.Platform['env']): AwsClient {
	return new AwsClient({
		accessKeyId: env.R2_ACCESS_KEY_ID,
		secretAccessKey: env.R2_SECRET_ACCESS_KEY,
		service: 's3',
		region: 'auto'
	});
}

function encodeKey(key: string): string {
	return key
		.split('/')
		.map((seg) => encodeURIComponent(seg))
		.join('/');
}

function objectUrl(env: App.Platform['env'], key: string): string {
	return `${env.R2_ENDPOINT}/${env.R2_BUCKET}/${encodeKey(key)}`;
}

export async function presignPut(
	client: AwsClient,
	env: App.Platform['env'],
	key: string,
	contentLength: number,
	contentType: string,
	expiresSeconds = 300
): Promise<string> {
	const url = new URL(objectUrl(env, key));
	url.searchParams.set('X-Amz-Expires', String(expiresSeconds));

	const req = new Request(url, {
		method: 'PUT',
		headers: { 'content-type': contentType }
	});
	const signed = await client.sign(req, { aws: { signQuery: true } });
	return signed.url;
}

export async function presignUploadPart(
	client: AwsClient,
	env: App.Platform['env'],
	key: string,
	uploadId: string,
	partNumber: number,
	expiresSeconds = 3600
): Promise<string> {
	const url = new URL(objectUrl(env, key));
	url.searchParams.set('partNumber', String(partNumber));
	url.searchParams.set('uploadId', uploadId);
	url.searchParams.set('X-Amz-Expires', String(expiresSeconds));

	const req = new Request(url, { method: 'PUT' });
	const signed = await client.sign(req, { aws: { signQuery: true } });
	return signed.url;
}

export async function createMultipart(
	client: AwsClient,
	env: App.Platform['env'],
	key: string,
	contentType: string
): Promise<string> {
	const url = `${objectUrl(env, key)}?uploads=`;
	const res = await client.fetch(url, {
		method: 'POST',
		headers: { 'content-type': contentType }
	});
	if (!res.ok) throw new Error(`createMultipart ${res.status}: ${await res.text()}`);
	const xml = await res.text();
	const m = xml.match(/<UploadId>([^<]+)<\/UploadId>/);
	if (!m) throw new Error('No UploadId in createMultipart response');
	return m[1];
}

export async function completeMultipart(
	client: AwsClient,
	env: App.Platform['env'],
	key: string,
	uploadId: string,
	parts: { PartNumber: number; ETag: string }[]
): Promise<void> {
	const body =
		`<CompleteMultipartUpload>` +
		parts
			.sort((a, b) => a.PartNumber - b.PartNumber)
			.map((p) => `<Part><PartNumber>${p.PartNumber}</PartNumber><ETag>${p.ETag}</ETag></Part>`)
			.join('') +
		`</CompleteMultipartUpload>`;

	const url = `${objectUrl(env, key)}?uploadId=${encodeURIComponent(uploadId)}`;
	const res = await client.fetch(url, {
		method: 'POST',
		headers: { 'content-type': 'application/xml' },
		body
	});
	if (!res.ok) throw new Error(`completeMultipart ${res.status}: ${await res.text()}`);
}

export async function deleteObject(
	client: AwsClient,
	env: App.Platform['env'],
	key: string
): Promise<void> {
	const url = objectUrl(env, key);
	const res = await client.fetch(url, { method: 'DELETE' });
	if (!res.ok && res.status !== 404) throw new Error(`deleteObject ${res.status}: ${await res.text()}`);
}

export async function putObject(
	client: AwsClient,
	env: App.Platform['env'],
	key: string,
	body: string,
	contentType: string
): Promise<void> {
	const url = objectUrl(env, key);
	const res = await client.fetch(url, {
		method: 'PUT',
		body,
		headers: { 'content-type': contentType }
	});
	if (!res.ok) throw new Error(`putObject ${res.status}: ${await res.text()}`);
}

export async function abortMultipart(
	client: AwsClient,
	env: App.Platform['env'],
	key: string,
	uploadId: string
): Promise<void> {
	const url = `${objectUrl(env, key)}?uploadId=${encodeURIComponent(uploadId)}`;
	await client.fetch(url, { method: 'DELETE' });
}

export interface S3Object {
	key: string;
	size: number;
	lastModified: Date;
}

export async function listObjects(
	client: AwsClient,
	env: App.Platform['env'],
	prefix?: string
): Promise<S3Object[]> {
	const results: S3Object[] = [];
	let continuationToken: string | undefined;

	do {
		const url = new URL(`${env.R2_ENDPOINT}/${env.R2_BUCKET}`);
		url.searchParams.set('list-type', '2');
		url.searchParams.set('max-keys', '1000');
		if (prefix) url.searchParams.set('prefix', prefix);
		if (continuationToken) url.searchParams.set('continuation-token', continuationToken);

		const res = await client.fetch(url.toString(), { method: 'GET' });
		if (!res.ok) throw new Error(`listObjects ${res.status}: ${await res.text()}`);

		const xml = await res.text();

		const keys = [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1]);
		const sizes = [...xml.matchAll(/<Size>([^<]+)<\/Size>/g)].map((m) => Number(m[1]));
		const dates = [...xml.matchAll(/<LastModified>([^<]+)<\/LastModified>/g)].map(
			(m) => new Date(m[1])
		);

		for (let i = 0; i < keys.length; i++) {
			results.push({ key: keys[i], size: sizes[i], lastModified: dates[i] });
		}

		const nextToken = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/)?.[1];
		continuationToken = nextToken;
	} while (continuationToken);

	return results;
}
