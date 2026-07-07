/**
 * Pure well-state logic for the upload page's single transforming well.
 *
 * See docs/adr/0002-sealed-manifest-lifecycle.md — the well is the sole
 * editable representation of the current transfer, moving through
 * empty -> working -> sealed as files are added and the reconciler settles.
 * `computeWellDisplay` decides which of those three states to render, plus
 * whether a link that's already visible should show an "updating…" hint
 * during a re-seal (see the ADR's "link stays visible during edits" call).
 */

import type { FileEntry } from './upload'
import type { TransferRow } from '../routes/upload/+page.server'

export type WellMode = 'empty' | 'working' | 'sealed'

export interface WellDisplay {
  mode: WellMode
  /** True only in 'sealed' mode: a re-seal is in flight and the visible
   * link may be momentarily stale (it never changes, but the underlying
   * manifest write hasn't confirmed yet). */
  updating: boolean
}

/**
 * Decide the well's display mode from live file state plus whether a link
 * has ever been produced for the current bundle (`hasLink`).
 *
 * - No files → empty.
 * - Files present but no link yet (first seal hasn't completed) → working,
 *   regardless of whether every file has finished uploading — the link
 *   isn't ready until the reconciler's write actually confirms.
 * - Files present and a link already exists → sealed. If anything is still
 *   queued/uploading, the well is mid re-seal: keep showing the link but
 *   flag `updating` so the UI can show a quiet "updating…" hint alongside
 *   it, per the ADR's "link stays visible and copyable throughout".
 */
export function computeWellDisplay(files: FileEntry[], hasLink: boolean): WellDisplay {
  if (files.length === 0) return { mode: 'empty', updating: false }
  if (!hasLink) return { mode: 'working', updating: false }
  const inFlight = files.some(f => f.status === 'queued' || f.status === 'uploading')
  return { mode: 'sealed', updating: inFlight }
}

/**
 * Build the optimistic Recent-transfers row for "Start new transfer": the
 * current well's state, reshaped into a TransferRow so it can be prepended
 * to the Recent list client-side before a reload re-fetches the real thing
 * from R2. Mirrors the title-fallback and size/count rules used server-side
 * in groupTransfers (see src/lib/server/recent.ts).
 */
export function buildOptimisticRow(params: {
  bundleId: string
  title: string
  files: FileEntry[]
  downloadUrl: string
}): TransferRow {
  const { bundleId, title, files, downloadUrl } = params
  const members = files.filter(f => f.status === 'done')
  const size = members.reduce((sum, f) => sum + f.file.size, 0)
  return {
    id: bundleId,
    kind: 'bundle',
    title: title.trim() || `flareshare-${bundleId}.zip`,
    fileCount: members.length,
    size,
    uploaded: new Date().toISOString(),
    downloadUrl,
  }
}
