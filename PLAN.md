# Personal File Drop — Implementation Plan

A minimal, single-user WeTransfer clone. GitHub OAuth gates uploads, anyone with a link can download, no database, files auto-expire via R2 lifecycle rules.

## Stack

- **SvelteKit** with `@sveltejs/adapter-cloudflare`
- **Cloudflare Pages** (hosting + Pages Functions for server routes)
- **Cloudflare R2** (object storage, zero egress, accessed via Worker binding)
- **GitHub OAuth** (single-user auth, restricted to your numeric GitHub ID)
- **`aws4fetch`** for SigV4 presigning (tiny, Worker-native; replaces AWS SDK)

Total cost: ~$0.015/GB/month of stored data. Zero egress, zero compute charges at this scale.

## Architecture

```
Browser ──POST /api/presign-upload──► SvelteKit endpoint (authed)
                                       ├── validates session
                                       ├── enforces size/type caps
                                       ├── single PUT if ≤5GB
                                       └── multipart init + per-part URLs if >5GB

Browser ──direct PUT(s)──► R2 bucket (S3 API, presigned URLs)
Browser ──POST /api/complete-multipart──► finalises multipart upload

Browser ──GET /d/:id──► SvelteKit endpoint (public)
                        ├── platform.env.BUCKET.list({ prefix })   # 1 extra op for clean URL
                        ├── platform.env.BUCKET.get(key)
                        └── stream body back with Content-Disposition: attachment
```

Uploads use presigned PUTs because Worker request body sizes are capped and we don't want bytes flowing through the function. Downloads stream from the R2 binding — no AWS SDK on the download path, no presigned GETs to leak, and Cloudflare's edge handles the transfer.

## Object key scheme

```
{nanoid-10}/{sanitised-filename}
```

Example: `xK9mP2nQ4z/quarterly-report.pdf`

- The random ID is the share token (10 chars from nanoid's URL-safe alphabet = ~60 bits).
- Filename preserved as the second path segment for the `Content-Disposition` header on download.
- Listing the prefix `xK9mP2nQ4z/` returns exactly one object — gives us the filename without a database, and keeps share URLs clean (`/d/{id}`).

## File size strategy

- **≤ 5 GB**: single presigned PUT.
- **> 5 GB, up to 100 GB**: multipart upload (R2 hard cap is 5 GB per single PUT; multipart parts up to 5 GB each, max 10,000 parts).
- Default part size: 64 MB. At that size, 100 GB ≈ 1,600 parts — well under the 10,000 limit.
- Client uploads up to 4 parts concurrently with retry-on-fail.

## Routes

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/` | GET | Public | Landing page, login link if not authed |
| `/auth/login` | GET | — | Generate OAuth state, redirect to GitHub |
| `/auth/callback` | GET | — | Exchange code, verify GitHub ID, set session cookie |
| `/auth/logout` | POST | Authed | Clear session cookie |
| `/upload` | GET | Authed | Drag-and-drop UI |
| `/api/presign-upload` | POST | Authed | Generate presigned PUT for a single file (≤5GB) |
| `/api/presign-multipart` | POST | Authed | Initiate multipart and return per-part presigned URLs |
| `/api/complete-multipart` | POST | Authed | Finalise multipart upload (CompleteMultipartUpload) |
| `/api/abort-multipart` | POST | Authed | Abort multipart upload (best-effort cleanup on client cancel) |
| `/d/[id]` | GET | Public | Stream file from R2 with `Content-Disposition: attachment` |

## Project layout

```
drop/
├── svelte.config.js
├── wrangler.toml
├── src/
│   ├── app.d.ts                          # Platform/locals types
│   ├── hooks.server.ts                   # Auth middleware + security headers
│   ├── lib/
│   │   └── server/
│   │       ├── session.ts                # Sign/verify session cookies (JWT)
│   │       ├── oauth.ts                  # GitHub OAuth helpers + state cookie
│   │       ├── r2-sign.ts                # aws4fetch-based SigV4 presigning helpers
│   │       ├── filename.ts               # Sanitisation + Content-Disposition encoding
│   │       └── ids.ts                    # nanoid wrapper
│   └── routes/
│       ├── +layout.svelte
│       ├── +page.svelte                  # Landing
│       ├── upload/
│       │   ├── +page.server.ts           # Requires auth
│       │   └── +page.svelte              # Drag-and-drop UI (single + multipart logic)
│       ├── auth/
│       │   ├── login/+server.ts
│       │   ├── callback/+server.ts
│       │   └── logout/+server.ts
│       ├── api/
│       │   ├── presign-upload/+server.ts
│       │   ├── presign-multipart/+server.ts
│       │   ├── complete-multipart/+server.ts
│       │   └── abort-multipart/+server.ts
│       └── d/
│           └── [id]/+server.ts           # Public download endpoint
└── package.json
```

## Key implementation patterns

### Presigning with `aws4fetch`

`aws4fetch` exposes an `AwsClient` that can sign arbitrary `Request` objects. To produce a presigned URL we sign a request with `aws: { signQuery: true }`.

> **R2 limitation**: R2's query-string (presigned URL) auth does **not** support signing `content-length`. Passing `allHeaders: true` to `aws4fetch` includes `content-length` in `X-Amz-SignedHeaders`, which causes R2 to return `InvalidArgument: Authorization`. Only sign `host` (the default). Size enforcement is handled server-side in the presign endpoints — that is the primary defence.

```ts
// lib/server/r2-sign.ts
import { AwsClient } from 'aws4fetch';

export function makeClient(env: App.Platform['env']) {
  return new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    service: 's3',
    region: 'auto',
  });
}

export async function presignPut(
  client: AwsClient,
  env: App.Platform['env'],
  key: string,
  contentLength: number,
  contentType: string,
  expiresSeconds = 300,
): Promise<string> {
  const url = new URL(`${env.R2_ENDPOINT}/${env.R2_BUCKET}/${encodeKey(key)}`);
  url.searchParams.set('X-Amz-Expires', String(expiresSeconds));

  const req = new Request(url, {
    method: 'PUT',
    headers: {
      'content-length': String(contentLength),
      'content-type': contentType,
    },
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
  contentLength: number,
  expiresSeconds = 3600,
): Promise<string> {
  const url = new URL(`${env.R2_ENDPOINT}/${env.R2_BUCKET}/${encodeKey(key)}`);
  url.searchParams.set('partNumber', String(partNumber));
  url.searchParams.set('uploadId', uploadId);
  url.searchParams.set('X-Amz-Expires', String(expiresSeconds));

  const req = new Request(url, {
    method: 'PUT',
    headers: { 'content-length': String(contentLength) },
  });
  const signed = await client.sign(req, { aws: { signQuery: true } });
  return signed.url;
}

function encodeKey(k: string): string {
  return k.split('/').map(encodeURIComponent).join('/');
}
```

**Multipart create / complete / abort** are server-to-R2 calls (not browser → R2), so they go through `client.fetch` directly:

```ts
export async function createMultipart(client: AwsClient, env, key, contentType): Promise<string> {
  const url = `${env.R2_ENDPOINT}/${env.R2_BUCKET}/${encodeKey(key)}?uploads=`;
  const res = await client.fetch(url, { method: 'POST', headers: { 'content-type': contentType } });
  if (!res.ok) throw new Error(`createMultipart ${res.status}`);
  const xml = await res.text();
  const m = xml.match(/<UploadId>([^<]+)<\/UploadId>/);
  if (!m) throw new Error('No UploadId in response');
  return m[1];
}

export async function completeMultipart(client: AwsClient, env, key, uploadId, parts: { PartNumber: number; ETag: string }[]) {
  const body =
    `<CompleteMultipartUpload>` +
    parts.sort((a, b) => a.PartNumber - b.PartNumber)
      .map(p => `<Part><PartNumber>${p.PartNumber}</PartNumber><ETag>${p.ETag}</ETag></Part>`)
      .join('') +
    `</CompleteMultipartUpload>`;
  const url = `${env.R2_ENDPOINT}/${env.R2_BUCKET}/${encodeKey(key)}?uploadId=${encodeURIComponent(uploadId)}`;
  const res = await client.fetch(url, { method: 'POST', headers: { 'content-type': 'application/xml' }, body });
  if (!res.ok) throw new Error(`completeMultipart ${res.status}: ${await res.text()}`);
}

export async function abortMultipart(client: AwsClient, env, key, uploadId) {
  const url = `${env.R2_ENDPOINT}/${env.R2_BUCKET}/${encodeKey(key)}?uploadId=${encodeURIComponent(uploadId)}`;
  await client.fetch(url, { method: 'DELETE' });
}
```

### `hooks.server.ts` — auth + security headers

```ts
import type { Handle } from '@sveltejs/kit';
import { verifySession } from '$lib/server/session';

const PROTECTED = [/^\/upload/, /^\/api\/presign-/, /^\/api\/complete-/, /^\/api\/abort-/];

export const handle: Handle = async ({ event, resolve }) => {
  const cookie = event.cookies.get('session');
  event.locals.user = cookie ? await verifySession(cookie, event.platform!.env.SESSION_SECRET) : null;

  if (PROTECTED.some(rx => rx.test(event.url.pathname)) && !event.locals.user) {
    return new Response('Unauthorized', { status: 401 });
  }

  const response = await resolve(event);

  if (response.headers.get('content-type')?.includes('text/html')) {
    response.headers.set('Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
      "connect-src 'self' https://*.r2.cloudflarestorage.com; " +
      "frame-ancestors 'none'; base-uri 'self';"
    );
    response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
    response.headers.set('Referrer-Policy', 'same-origin');
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('X-Frame-Options', 'DENY');
    response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  }

  return response;
};
```

### Session module (`lib/server/session.ts`)

Use `@tsndr/cloudflare-worker-jwt` for HMAC-signed tokens.

```ts
import jwt from '@tsndr/cloudflare-worker-jwt';

export async function createSession(userId: number, secret: string): Promise<string> {
  return jwt.sign({ sub: userId, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30 }, secret);
}

export async function verifySession(token: string, secret: string): Promise<{ id: number } | null> {
  const valid = await jwt.verify(token, secret);
  if (!valid) return null;
  const { payload } = jwt.decode(token);
  return { id: payload.sub as number };
}
```

Cookie settings everywhere it's set:
```ts
cookies.set('session', token, {
  path: '/',
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  maxAge: 60 * 60 * 24 * 30,
});
```

### OAuth login (`routes/auth/login/+server.ts`)

```ts
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ cookies, platform, url }) => {
  const state = crypto.randomUUID();
  cookies.set('oauth_state', state, {
    path: '/', httpOnly: true, secure: true, sameSite: 'lax', maxAge: 600,
  });

  const params = new URLSearchParams({
    client_id: platform!.env.GITHUB_CLIENT_ID,
    redirect_uri: `${url.origin}/auth/callback`,
    scope: 'read:user',
    state,
  });

  return Response.redirect(`https://github.com/login/oauth/authorize?${params}`, 302);
};
```

### OAuth callback (`routes/auth/callback/+server.ts`)

```ts
export const GET: RequestHandler = async ({ url, cookies, platform }) => {
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const expectedState = cookies.get('oauth_state');

  if (!code || !state || state !== expectedState) {
    return new Response('Invalid OAuth state', { status: 400 });
  }
  cookies.delete('oauth_state', { path: '/' });

  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: platform!.env.GITHUB_CLIENT_ID,
      client_secret: platform!.env.GITHUB_CLIENT_SECRET,
      code,
    }),
  });
  const { access_token } = await tokenRes.json<any>();

  const userRes = await fetch('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${access_token}`, 'User-Agent': 'drop-app' },
  });
  const user = await userRes.json<{ id: number }>();

  if (user.id !== Number(platform!.env.ALLOWED_GITHUB_ID)) {
    return new Response('Forbidden', { status: 403 });
  }

  const session = await createSession(user.id, platform!.env.SESSION_SECRET);
  cookies.set('session', session, {
    path: '/', httpOnly: true, secure: true, sameSite: 'lax', maxAge: 60 * 60 * 24 * 30,
  });

  return Response.redirect(`${url.origin}/upload`, 302);
};
```

### Single-PUT presign (`routes/api/presign-upload/+server.ts`)

```ts
import type { RequestHandler } from './$types';
import { makeClient, presignPut } from '$lib/server/r2-sign';
import { sanitiseFilename } from '$lib/server/filename';
import { newId } from '$lib/server/ids';

const MAX_SINGLE_PUT = 5 * 1024 * 1024 * 1024; // 5 GB — R2 single-PUT ceiling

export const POST: RequestHandler = async ({ request, platform, url }) => {
  const { filename, size, contentType } = await request.json();

  if (typeof size !== 'number' || size <= 0 || size > MAX_SINGLE_PUT) {
    return new Response('Invalid size for single PUT (use multipart for >5GB)', { status: 400 });
  }
  const safe = sanitiseFilename(filename);
  if (!safe) return new Response('Invalid filename', { status: 400 });

  const id = newId();
  const key = `${id}/${safe}`;

  const client = makeClient(platform!.env);
  const uploadUrl = await presignPut(client, platform!.env, key, size, contentType, 300);

  return Response.json({ id, key, uploadUrl, downloadUrl: `${url.origin}/d/${id}` });
};
```

### Multipart init (`routes/api/presign-multipart/+server.ts`)

```ts
import type { RequestHandler } from './$types';
import { makeClient, createMultipart, presignUploadPart } from '$lib/server/r2-sign';
import { sanitiseFilename } from '$lib/server/filename';
import { newId } from '$lib/server/ids';

const MAX_TOTAL = 100 * 1024 * 1024 * 1024;    // 100 GB
const MIN_PART  = 5 * 1024 * 1024;              // 5 MB (S3 minimum, except last part)
const MAX_PART  = 5 * 1024 * 1024 * 1024;       // 5 GB
const MAX_PARTS = 10_000;

export const POST: RequestHandler = async ({ request, platform, url }) => {
  const { filename, size, contentType, partSize, partCount } = await request.json();

  if (typeof size !== 'number' || size <= 0 || size > MAX_TOTAL) {
    return new Response('Invalid size', { status: 400 });
  }
  if (typeof partSize !== 'number' || partSize < MIN_PART || partSize > MAX_PART) {
    return new Response('Invalid partSize', { status: 400 });
  }
  if (typeof partCount !== 'number' || partCount < 1 || partCount > MAX_PARTS) {
    return new Response('Invalid partCount', { status: 400 });
  }
  // Sanity: partCount must cover total size with last part possibly smaller
  const minExpected = (partCount - 1) * partSize + 1;
  const maxExpected = partCount * partSize;
  if (size < minExpected || size > maxExpected) {
    return new Response('size / partSize / partCount mismatch', { status: 400 });
  }

  const safe = sanitiseFilename(filename);
  if (!safe) return new Response('Invalid filename', { status: 400 });

  const id = newId();
  const key = `${id}/${safe}`;
  const client = makeClient(platform!.env);

  const uploadId = await createMultipart(client, platform!.env, key, contentType ?? 'application/octet-stream');

  // Presign every part URL up-front (1h expiry — enough for 100GB on a typical connection).
  // For very long uploads, refresh by re-requesting.
  const parts: { partNumber: number; url: string; size: number }[] = [];
  for (let i = 1; i <= partCount; i++) {
    const thisSize = i === partCount ? size - (partCount - 1) * partSize : partSize;
    const url = await presignUploadPart(client, platform!.env, key, uploadId, i, thisSize, 3600);
    parts.push({ partNumber: i, url, size: thisSize });
  }

  return Response.json({
    id,
    key,
    uploadId,
    parts,
    downloadUrl: `${url.origin}/d/${id}`,
  });
};
```

### Multipart complete (`routes/api/complete-multipart/+server.ts`)

```ts
import type { RequestHandler } from './$types';
import { makeClient, completeMultipart } from '$lib/server/r2-sign';

export const POST: RequestHandler = async ({ request, platform }) => {
  const { key, uploadId, parts } = await request.json();
  // parts: [{ PartNumber: number, ETag: string }]
  if (!key || !uploadId || !Array.isArray(parts) || parts.length === 0) {
    return new Response('Invalid request', { status: 400 });
  }
  const client = makeClient(platform!.env);
  await completeMultipart(client, platform!.env, key, uploadId, parts);
  return new Response(null, { status: 204 });
};
```

### Filename sanitiser (`lib/server/filename.ts`)

```ts
export function sanitiseFilename(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const cleaned = input
    .replace(/[\x00-\x1F\x7F]/g, '')
    .replace(/[\/\\]/g, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 200);
  return cleaned.length > 0 ? cleaned : null;
}

export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '');
  const encoded = encodeURIComponent(filename);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
```

### Download endpoint (`routes/d/[id]/+server.ts`)

```ts
import type { RequestHandler } from './$types';
import { contentDisposition } from '$lib/server/filename';

export const GET: RequestHandler = async ({ params, platform }) => {
  const { id } = params;

  if (!/^[A-Za-z0-9_-]{10}$/.test(id)) {
    return new Response('Not found', { status: 404 });
  }

  const listed = await platform!.env.BUCKET.list({ prefix: `${id}/`, limit: 1 });
  if (!listed.objects.length) return new Response('Not found', { status: 404 });

  const obj = listed.objects[0];
  const file = await platform!.env.BUCKET.get(obj.key);
  if (!file) return new Response('Not found', { status: 404 });

  const filename = obj.key.slice(id.length + 1);

  return new Response(file.body, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': contentDisposition(filename),
      'Content-Length': String(obj.size),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
      'Referrer-Policy': 'no-referrer',
    },
  });
};
```

### Upload UI (`routes/upload/+page.svelte`)

- Drag-and-drop zone with `dragover`/`drop` listeners.
- For each file:
  - If `size ≤ 5GB`: hit `/api/presign-upload`, single `XMLHttpRequest` PUT, watch `xhr.upload.onprogress`.
  - If `size > 5GB`: hit `/api/presign-multipart`, slice file into parts, PUT each (up to 4 concurrent) using `XMLHttpRequest`, capture `ETag` from each response, then POST to `/api/complete-multipart`.
- On abort/error after init, best-effort POST `/api/abort-multipart` so we don't leave orphans.
- After success: show `downloadUrl` with copy button + "expires in 7 days" note.
- Sign-out link.

## R2 configuration

1. **Create bucket** `drop-prod` in the Cloudflare dashboard.
2. **CORS policy** — note the headers needed for SigV4 + multipart:
   ```json
   [{
     "AllowedOrigins": ["https://drop.yourdomain.com"],
     "AllowedMethods": ["PUT"],
     "AllowedHeaders": ["content-type", "content-length", "x-amz-content-sha256", "x-amz-date"],
     "ExposeHeaders": ["ETag"],
     "MaxAgeSeconds": 3600
   }]
   ```
   `ETag` must be in `ExposeHeaders` so the client can read it from each part response.
3. **Lifecycle rules**:
   - Delete objects 7 days after creation.
   - Abort incomplete multipart uploads after 1 day (prevents orphan part billing).
   Configure via dashboard or `wrangler r2 bucket lifecycle add`.
4. **R2 API token** with read/write scoped to this bucket only. Used for presigning + multipart admin calls.
5. **Binding** in `wrangler.toml` (used for downloads):
   ```toml
   name = "drop"
   compatibility_date = "2025-01-01"
   pages_build_output_dir = ".svelte-kit/cloudflare"

   [[r2_buckets]]
   binding = "BUCKET"
   bucket_name = "drop-prod"
   ```

## Environment variables / secrets

```
GITHUB_CLIENT_ID=…
GITHUB_CLIENT_SECRET=…          # secret
ALLOWED_GITHUB_ID=12345678
SESSION_SECRET=…                # secret, 32+ random bytes
R2_ACCOUNT_ID=…
R2_ACCESS_KEY_ID=…
R2_SECRET_ACCESS_KEY=…          # secret
R2_BUCKET=drop-prod
R2_ENDPOINT=https://<account>.r2.cloudflarestorage.com
```

Get your numeric GitHub ID: `curl https://api.github.com/users/<your-username>` → `id` field.

## Type definitions (`src/app.d.ts`)

```ts
declare global {
  namespace App {
    interface Locals { user: { id: number } | null }
    interface Platform {
      env: {
        BUCKET: R2Bucket;
        GITHUB_CLIENT_ID: string;
        GITHUB_CLIENT_SECRET: string;
        ALLOWED_GITHUB_ID: string;
        SESSION_SECRET: string;
        R2_ACCOUNT_ID: string;
        R2_ACCESS_KEY_ID: string;
        R2_SECRET_ACCESS_KEY: string;
        R2_BUCKET: string;
        R2_ENDPOINT: string;
      };
    }
  }
}
export {};
```

## Dependencies

```json
{
  "@sveltejs/adapter-cloudflare": "^4",
  "aws4fetch": "^1",
  "@tsndr/cloudflare-worker-jwt": "^2",
  "nanoid": "^5"
}
```

## Deployment

1. `pnpm create svelte@latest drop` → Skeleton, TypeScript, ESLint.
2. `pnpm add -D @sveltejs/adapter-cloudflare` and configure `svelte.config.js`.
3. Create R2 bucket; configure CORS + both lifecycle rules (7-day expiry, 1-day multipart abort).
4. Register GitHub OAuth App:
   - Homepage URL: `https://drop.yourdomain.com`
   - Callback URL: `https://drop.yourdomain.com/auth/callback`
5. Connect repo to Cloudflare Pages (build `pnpm build`, output `.svelte-kit/cloudflare`).
6. Add all env vars / secrets in Pages project settings.
7. Bind R2 bucket under Pages → Functions → R2.
8. Custom domain.
9. Push to deploy.

---

## Security

### Authentication boundary

- Verify the numeric GitHub `id`, not `login` (usernames can be changed/reused).
- OAuth `state` cookie is mandatory and short-lived.
- Session cookie: `HttpOnly`, `Secure`, `SameSite=Lax`, HMAC via JWT.
- `SESSION_SECRET` rotation invalidates all sessions instantly.
- 30-day session lifetime.

### Presigned URL safety

- **Server-side size validation is the primary defence.** R2's presigned (query-string) auth does not support signing `content-length` — `allHeaders: true` causes `InvalidArgument: Authorization`. Size caps are enforced by the presign endpoints before a URL is issued.
- **5-min expiry for single PUTs, 1h for multipart parts** (longer because 100GB uploads take time).
- Never log presigned URLs.
- No presigned GETs — downloads go through the R2 binding.

### Share links are capability URLs

- 10-char nanoid (~60 bits): non-brute-forceable, but enumerable if a listing endpoint exists. So don't expose one.
- Validate ID shape `/^[A-Za-z0-9_-]{10}$/` before touching R2.
- Bucket is private; no public-read policy.
- `Referrer-Policy: no-referrer` on download responses.

### Filename safety

- Sanitise on upload: strip path separators, control chars, null bytes, leading dots. Cap 200 chars.
- `Content-Disposition: attachment` on every download — prevents stored XSS via uploaded HTML/SVG/PDF.
- `Content-Type: application/octet-stream` on downloads; never echo client MIME.
- `X-Content-Type-Options: nosniff` on downloads.
- RFC 5987 encoding for `Content-Disposition`.

### Upload abuse limits

- Server-side max enforced in presign endpoints (5 GB single, 100 GB multipart).
- Multipart param sanity check: `partCount * partSize` envelope must contain `size`.
- Modest rate limit on authed endpoints (60 presigns/min).
- Cloudflare billing alert.

### Multipart orphan prevention

- Lifecycle rule: abort incomplete multipart uploads after 1 day.
- Client posts to `/api/abort-multipart` on cancel/error (best-effort; lifecycle is the backstop).

### CSRF

- `SameSite=Lax` cookie.
- All state-changing endpoints are POST.
- No CORS on `/api/*`.

### CORS

- Bucket CORS restricted to your exact origin.
- App API endpoints — no CORS at all.

### Security headers

HTML responses — CSP is set by SvelteKit via `csp: { mode: 'nonce' }` in `svelte.config.js` (do **not** set it manually in `hooks.server.ts`; that overrides the nonce SvelteKit injects into its inline hydration scripts, breaking the page). Other headers are set in `hooks.server.ts`:
- `Content-Security-Policy: default-src 'self'; script-src 'self' 'nonce-…'; connect-src 'self' https://*.r2.cloudflarestorage.com; frame-ancestors 'none'` (nonce added automatically per request)
- `Strict-Transport-Security: max-age=63072000; includeSubDomains`
- `X-Frame-Options: DENY`
- `Referrer-Policy: same-origin`
- `X-Content-Type-Options: nosniff`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`

Download responses:
- `Content-Disposition: attachment; filename*=UTF-8''…`
- `Content-Type: application/octet-stream`
- `X-Content-Type-Options: nosniff`
- `Cache-Control: private, no-store`
- `Referrer-Policy: no-referrer`

### Intentionally skipped

- Virus scanning, client-side encryption, audit logging beyond Cloudflare request logs.

### The two most likely failure modes

1. A presigned PUT leaks without size constraints → garbage upload eats storage. Mitigated by server-side size validation in the presign endpoint (R2 doesn't support signing `content-length` in presigned URLs) + billing alert.
2. An uploaded HTML/SVG renders in-browser at your origin → stored XSS. Mitigated by `Content-Disposition: attachment` + `Content-Type: application/octet-stream` + `nosniff`.

---

## Nice-to-haves (skip for v1)

- Per-file custom expiry (would need metadata → bring back D1 or Turso)
- Download counter
- Password-protected links
- Preview page for images/PDFs
- "Recent uploads" list (R2 list with no prefix)

## What's intentionally not here

- No email sending
- No virus scanning
- No multi-user accounts
- No database
