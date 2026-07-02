# Friendly "unavailable transfer" page via internal proxy

When a share link points to a transfer that is gone or never existed, `/d/[id]` must
show a styled, branded page (expired / doesn't exist) **at the original URL** while
reusing the app's design system. Because `/d/[id]` is a streaming `+server.ts` endpoint
(not a page), on the not-found path it makes an internal subrequest with its own `fetch`
to a real Svelte page (`/gone`, or a 503 try-again page for transient R2 errors) and
returns that page's HTML with the appropriate error status at the original URL.

## Why not the obvious alternatives

- **`+page.svelte` + `+server.ts` content negotiation** — SvelteKit picks page vs
  endpoint by the `Accept` header, but a browser navigating to download a file also sends
  `Accept: text/html`. Negotiation can't tell "view" from "download", so it would hijack
  the actual download. Rejected.
- **Redirect to a page route (302/303)** — replaces the original URL in the address bar
  and breaks refresh-to-retry. The URL-preservation requirement rules it out.
- **Hand-written inline HTML in the endpoint** — works and preserves the URL, but
  duplicates fonts/tokens and drifts from the Svelte design system over time. Rejected.
- **Adding persistence to distinguish "expired" from "never existed"** — there is no
  database (see [CONTEXT.md](../../CONTEXT.md)); both states present identically. We chose
  a single combined message over reintroducing storage just to tell them apart.

## Consequence

A future reader may be tempted to "simplify" the internal `fetch` into a redirect or a
page route — doing so would silently break URL preservation. The proxy is deliberate.
Mid-download failures on multi-file ZIPs remain uncovered (headers are already flushed —
an existing accepted risk).
