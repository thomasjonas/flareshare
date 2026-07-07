# Sealed manifest lifecycle: a live, editable transfer

A transfer is no longer committed by a one-shot "Create link" button. The upload well is
now the single, editable representation of the current transfer: files stream in place,
and the share link is generated automatically once the well settles. The sender can then
keep renaming and adding/removing files, and the link stays current — until they start a
new transfer, at which point it graduates into Recent transfers.

To support this, `{id}/manifest.json` gains a **`sealed`** boolean and becomes a mutable,
repeatedly-rewritten object rather than a write-once commit:

- **Sealed** (`sealed: true`) — the bundle is settled (no upload in flight) with ≥1 file.
  `/d/{id}` serves it.
- **Unsealed** (`sealed: false`) — the sender is mid-edit (a file is uploading). `/d/{id}`
  shows a dedicated static `/in-progress` page, **not** `/gone`.
- **Absent** — no manifest. `/d/{id}` shows `/gone` (Unavailable transfer), as before.

Back-compat: manifests written before this change have no `sealed` field, so **missing is
treated as sealed** — every pre-existing bundle stays downloadable.

All manifest writes flow through **one debounced, serialized reconcile** (never concurrent
PUTs) that recomputes from live client state on each run: members = fully-uploaded files,
`sealed = (nothing in flight) && members.length > 0`. Emptying the well deletes the bundle.

## The central trade-off: link goes dark during edits (Reading B over Reading A)

When a sender adds a file to an already-shared transfer, the manifest un-seals and the
live link **stops resolving** (shows `/in-progress`) until it re-seals. We chose this
(**Reading B**) over the simpler **Reading A**, where the link would keep serving the last
*complete* set while the new file uploaded.

- Reading A needs no in-progress state and never breaks a shared link, but a recipient
  could download a transfer that is missing the file the sender is actively adding.
- Reading B guarantees a recipient never downloads a transfer mid-edit, at the cost of
  briefly darkening a link that may already be shared, plus the `sealed` state itself.

The requirement — "the link must never be downloadable mid-edit" — is a deliberate product
stance, and Reading A cannot satisfy it. Reading B can.

## Invariant (do not weaken)

The manifest may momentarily lag reality, but it is **never `sealed: true` while any upload
is in flight**. The worst observable state is a brief `/in-progress` page — never a
premature or partial download. This is why sealing must be a reconcile that reads live
state at write time, not an eager "write sealed on file-done" (which races a concurrent
add and can publish a sealed manifest missing the new file).

## Why not the obvious alternatives

- **A separate marker object** (e.g. `{id}/.lock`) to signal in-progress, keeping the
  manifest write-once-when-complete — preserves the "manifest is never partial" purity, but
  buys little once we've accepted a link that goes dark, and it costs a delete-manifest +
  write-marker dance on every edit transition. A single flag on the one source-of-truth
  object is simpler. Rejected.
- **Deleting the manifest during edits** — reads as `/gone` at the download endpoint, which
  is the wrong message (the transfer is coming, not gone). A positive storage signal is
  required to distinguish In-progress from Unavailable. Rejected.
- **Keeping the manual "Create link" commit** — avoids mutable manifests entirely, but
  can't deliver the auto-generated, still-editable link the flow is built around. Rejected.

## Consequence

This departs from the stateless "existence is implied by objects" model in
[CONTEXT.md](../../CONTEXT.md): the manifest now carries lifecycle state. `groupTransfers`
(Recent transfers) must skip unsealed bundles, and the download endpoint gains the
In-progress branch. A future reader tempted to "simplify" by writing `sealed` eagerly on
file completion, or by running manifest writes concurrently, would reintroduce the race the
reconcile exists to prevent. Abandoned in-progress uploads leave orphan objects (and an
unsealed manifest) in R2 until the 14-day lifecycle sweep — invisible everywhere, an
accepted cost of not tracking draft state.
