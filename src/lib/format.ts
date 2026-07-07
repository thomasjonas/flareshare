// Human-readable formatting helpers shared across the upload UI.

export const EXPIRY_DAYS = 14 // matches the R2 lifecycle expiry rule

export function fmt(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

export function fmtSpeed(bps: number): string {
  if (!bps || !isFinite(bps)) return '—'
  if (bps < 1024 ** 2) return `${(bps / 1024).toFixed(0)} KB/s`
  if (bps < 1024 ** 3) return `${(bps / 1024 ** 2).toFixed(1)} MB/s`
  return `${(bps / 1024 ** 3).toFixed(2)} GB/s`
}

export function fmtEta(s: number): string {
  if (!isFinite(s) || isNaN(s)) return '—'
  if (s < 60) return `${Math.ceil(s)}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${Math.ceil(s % 60)}s`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}

export function timeAgo(iso: string): string {
  const t = Date.parse(iso)
  if (isNaN(t)) return ''
  const diff = (Date.now() - t) / 1000
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`
  return new Date(t).toLocaleDateString()
}

export function expiresIn(iso: string): string {
  const t = Date.parse(iso)
  if (isNaN(t)) return `${EXPIRY_DAYS}d 00h`
  const ms = EXPIRY_DAYS * 86400 * 1000 - (Date.now() - t)
  if (ms <= 0) return 'expired'
  const days = Math.floor(ms / 86400000)
  const hours = Math.floor((ms % 86400000) / 3600000)
  return `${days}d ${String(hours).padStart(2, '0')}h`
}
