# Flareshare

A minimal, single-user file drop. One GitHub account may upload; anyone with a link
may download. No database — a transfer's existence is implied by its objects living in
R2, and ends when an expiry rule sweeps them.

## Language

**Transfer**:
The user-facing unit of sharing: one link that carries 1..N files. What a recipient
"receives."
_Avoid_: drop, upload (as a noun)

**Bundle**:
The storage realization of a transfer — an `{id}/` prefix in R2 holding member objects
plus a manifest. Internal term; users never see it.

**Share link**:
The public capability URL for a transfer, `/d/{id}`. Knowing it is the only thing
required to download — there is no sign-in.
_Avoid_: download link, URL

**Expiry**:
The point at which a bundle's objects are swept by the R2 lifecycle rule, after which the
share link no longer works. Because there is no database, an expired transfer is
indistinguishable from one that never existed.

**Unavailable transfer**:
The state a share link is in when its transfer is gone or never existed — expired,
mistyped, or abandoned before finalize. All present identically to the server (no objects
under the id) and are shown one combined "expired or doesn't exist" page.
_Avoid_: broken link, dead link, 404

**In-progress transfer**:
The state a transfer is in when its share link exists but is deliberately not yet
downloadable because the sender is still assembling it — uploading, adding, or removing
files. Distinct from an Unavailable transfer: the transfer is real and coming, so the
share link shows a dedicated "still being prepared" page rather than the "gone" page. A
transfer flips out of this state once it is **sealed**.
_Avoid_: pending, draft, half-finished

**Sealed**:
The property of a transfer being ready to download: settled (no upload in flight) with at
least one file. Only a sealed transfer serves its files; an unsealed one is In-progress.
Sealing is repeatable — adding or removing a file un-seals a transfer, and it re-seals
once it settles again.
