import { createHash } from 'node:crypto'
import path from 'node:path'

/**
 * Prefix on every entry this CLI writes into a file outside the project it was run in.
 *
 * A global config is shared by every project on the machine. Without a per-project name,
 * two projects that both define a server called `fetch` overwrite each other's entry, and
 * `agents reset` in one of them deletes the entry belonging to the other.
 */
export const MANAGED_GLOBAL_NAME_PREFIX = 'agents__'

/** Stable prefix for one project's entries, derived from its path. */
export function getProjectScopePrefix(projectRoot: string): string {
  const hash = createHash('sha1').update(path.resolve(projectRoot)).digest('hex').slice(0, 12)
  return `${MANAGED_GLOBAL_NAME_PREFIX}${hash}__`
}

/** Name a server takes inside a global config when this project writes it. */
export function toProjectScopedName(projectRoot: string, serverName: string): string {
  return `${getProjectScopePrefix(projectRoot)}${serverName}`
}

/** Whether an entry in a global config belongs to this project. */
export function isProjectScopedName(projectRoot: string, serverName: string): boolean {
  return serverName.startsWith(getProjectScopePrefix(projectRoot))
}

/** The source server name behind a scoped entry, or the name unchanged. */
export function fromProjectScopedName(projectRoot: string, serverName: string): string {
  const prefix = getProjectScopePrefix(projectRoot)
  return serverName.startsWith(prefix) ? serverName.slice(prefix.length) : serverName
}

/**
 * Rename the keys of a generated map into this project's scope.
 *
 * `renameValue` lets a format that repeats the name inside the entry keep the two in
 * step; Goose stores the extension name in both the key and a `name` field.
 */
export function scopeManagedEntries<T>(
  projectRoot: string,
  entries: Record<string, T>,
  renameValue?: (value: T, scopedName: string) => T,
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(entries).map(([name, value]) => {
      const scoped = toProjectScopedName(projectRoot, name)
      return [scoped, renameValue ? renameValue(value, scoped) : value]
    }),
  )
}
