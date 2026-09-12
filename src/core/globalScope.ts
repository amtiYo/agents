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

/**
 * Bare-named entries in a shared config that this project wrote before names carried the
 * project.
 *
 * The state file is the usual record of what to remove, but it lives in
 * `.agents/generated`, which is gitignored: a fresh clone or `git clean` leaves the old
 * entries with nobody claiming them, and they would sit next to the new ones forever.
 * Content settles it. An entry under the bare name whose value matches what this project
 * is about to write is this project's own leftover. Anything else stays, because it
 * belongs to the user or to another project.
 */
export function findLegacyManagedNames(
  existingEntries: Record<string, unknown>,
  generatedEntries: Record<string, unknown>,
): { migrated: string[]; foreign: string[] } {
  const migrated: string[] = []
  const foreign: string[] = []

  for (const [name, generated] of Object.entries(generatedEntries)) {
    if (!(name in existingEntries)) continue
    if (JSON.stringify(existingEntries[name]) === JSON.stringify(generated)) migrated.push(name)
    else foreign.push(name)
  }

  return { migrated: migrated.sort(), foreign: foreign.sort() }
}

/** One warning per bare entry left alone because its content is not this project's. */
export function formatForeignLegacyWarnings(label: string, names: string[]): string[] {
  return names.map(
    (name) =>
      `${label}: an entry named "${name}" is not written by this project and was left alone. `
        + 'Entries this CLI writes now carry the project they came from; remove that one by hand '
        + 'if an older version of this project left it behind.',
  )
}
