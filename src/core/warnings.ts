export function normalizeWarnings(warnings: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const warning of warnings) {
    const compact = warning.trim()
    if (!compact) continue
    if (seen.has(compact)) continue
    seen.add(compact)
    out.push(compact)
  }
  return out
}

export function formatWarnings(warnings: string[], maxItems = 5): string | null {
  const normalized = normalizeWarnings(warnings)
  if (normalized.length === 0) return null

  const visible = normalized.slice(0, maxItems)
  const hidden = normalized.length - visible.length

  if (hidden <= 0) {
    return `Warnings:\n- ${visible.join('\n- ')}\n`
  }

  return `Warnings:\n- ${visible.join('\n- ')}\n- ... and ${String(hidden)} more warning(s)\n`
}

