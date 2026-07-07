/**
 * Auto-seal reconcile: the single decision + scheduling logic that decides
 * when and how the client writes (or deletes) a bundle's manifest.
 *
 * See docs/adr/0002-sealed-manifest-lifecycle.md — the invariant this module
 * exists to protect is that the manifest is NEVER written with `sealed: true`
 * while any upload is in flight. `computeReconcileAction` is pure and reads
 * only the live `FileEntry[]` it is given; `createReconciler` is the stateful
 * debounce/serialize shell around it, built so every actual write reads live
 * state at the moment it fires — never state captured when it was scheduled.
 */

import type { FileEntry } from './upload'

export type ReconcileAction =
  | { type: 'skip' }
  | { type: 'delete' }
  | { type: 'write'; sealed: boolean; members: FileEntry[] }

/**
 * Pure decision: given the current set of tray entries, what should the
 * reconcile do?
 *
 * - No `done` files at all → nothing worth persisting. If something is still
 *   in flight, wait (skip); a manifest can't be written with zero files
 *   anyway (see buildManifest). If nothing is in flight either, the well is
 *   effectively empty — delete the bundle.
 * - At least one `done` file → write, with `sealed` true only when nothing
 *   is `queued`/`uploading`. `error`/`aborted` entries don't count as
 *   in-flight and aren't included as members.
 */
export function computeReconcileAction(files: FileEntry[]): ReconcileAction {
  const members = files.filter(f => f.status === 'done')
  const inFlight = files.some(f => f.status === 'queued' || f.status === 'uploading')

  if (members.length === 0) {
    return inFlight ? { type: 'skip' } : { type: 'delete' }
  }

  return { type: 'write', sealed: !inFlight, members }
}

export interface ReconcilerState {
  bundleId: string | null
  title: string
  files: FileEntry[]
}

export interface ReconcilerDeps {
  /** Read live state — called at the moment the reconcile actually runs. */
  getState: () => ReconcilerState
  /** Perform the manifest write (PUT). Must resolve/reject; never called concurrently. */
  write: (bundleId: string, title: string, members: FileEntry[], sealed: boolean) => Promise<void>
  /** Delete the bundle (well went empty). */
  del: (bundleId: string) => Promise<void>
  /** Debounce window in ms. Defaults to 400. */
  debounceMs?: number
}

/**
 * The single, debounced, serialized reconcile loop. `schedule()` is the only
 * entry point callers use — it's safe to call on every keystroke/state
 * change; bursts collapse into one write and writes never overlap.
 *
 * Guarantees:
 * - Debounced: a burst of schedule() calls within the window fires once.
 * - Serialized: if schedule() fires while a write/delete is still in flight,
 *   the run is deferred (never a second concurrent PUT) and re-fires
 *   immediately once the in-flight one settles — reading live state again at
 *   that point, so the trailing write always reflects settled truth.
 * - Live state: every actual run reads `getState()` fresh, never state
 *   captured at schedule() time — this is what prevents ever observing
 *   `sealed: true` while an upload race is in flight.
 */
export function createReconciler(deps: ReconcilerDeps) {
  const debounceMs = deps.debounceMs ?? 400
  let timer: ReturnType<typeof setTimeout> | null = null
  let running = false
  let pending = false

  async function run() {
    const { bundleId, title, files } = deps.getState()
    if (!bundleId) return
    const action = computeReconcileAction(files)
    if (action.type === 'skip') return
    if (action.type === 'delete') {
      await deps.del(bundleId)
      return
    }
    await deps.write(bundleId, title, action.members, action.sealed)
  }

  function fire() {
    if (running) {
      // A write/delete is already in flight — coalesce into a trailing run
      // rather than starting a second, concurrent one.
      pending = true
      return
    }
    running = true
    run().finally(() => {
      running = false
      if (pending) {
        pending = false
        fire() // trailing reconcile: no extra debounce delay, live state re-read
      }
    })
  }

  function schedule() {
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      fire()
    }, debounceMs)
  }

  return { schedule }
}
