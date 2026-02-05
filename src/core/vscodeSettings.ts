import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { applyEdits, modify, parse, type ParseError } from 'jsonc-parser'
import type { VscodeSettingsState } from '../types.js'
import { pathExists, readJson, removeIfExists, writeJsonAtomic, writeTextAtomic } from './fs.js'

const DEFAULT_STATE: VscodeSettingsState = {
  managedPaths: []
}

export async function syncVscodeSettings(args: {
  settingsPath: string
  statePath: string
  hiddenPaths: string[]
  hideGenerated: boolean
  check: boolean
  changed: string[]
  warnings: string[]
  projectRoot: string
}): Promise<void> {
  const { settingsPath, statePath, hiddenPaths, hideGenerated, check, changed, warnings, projectRoot } = args
  const hasSettings = await pathExists(settingsPath)
  const raw = hasSettings ? await readFile(settingsPath, 'utf8') : '{}\n'
  const state = await loadState(statePath, warnings)
  const managedSet = new Set(state.managedPaths)

  const parseErrors: ParseError[] = []
  const parsed = parse(raw, parseErrors, {
    allowTrailingComma: true,
    disallowComments: false
  })

  if (parseErrors.length > 0 || !isObject(parsed)) {
    if (hasSettings) {
      warnings.push('Cannot parse .vscode/settings.json (JSONC). Skipped VS Code hide sync.')
    }
    return
  }

  let text = raw
  let settingsChanged = false

  if (hideGenerated) {
    const normalized = [...new Set(hiddenPaths.filter((item) => item.trim().length > 0))]
    const filesExclude = asObject(parsed['files.exclude'])
    const searchExclude = asObject(parsed['search.exclude'])

    const newlyManaged = new Set<string>()
    for (const target of normalized) {
      if (!(target in filesExclude)) {
        text = applyModify(text, ['files.exclude', target], true)
        settingsChanged = true
        newlyManaged.add(target)
      }
      if (!(target in searchExclude)) {
        text = applyModify(text, ['search.exclude', target], true)
        settingsChanged = true
        newlyManaged.add(target)
      }
    }

    for (const target of newlyManaged) {
      managedSet.add(target)
    }
  } else if (managedSet.size > 0) {
    for (const target of [...managedSet]) {
      const before = text
      text = applyModify(text, ['files.exclude', target], undefined)
      text = applyModify(text, ['search.exclude', target], undefined)
      if (text !== before) {
        settingsChanged = true
      }
      managedSet.delete(target)
    }

    text = cleanupEmptyObject(text, 'files.exclude')
    text = cleanupEmptyObject(text, 'search.exclude')
  }

  if (settingsChanged) {
    changed.push(relativePath(projectRoot, settingsPath))
    if (!check) {
      await writeTextAtomic(settingsPath, ensureTrailingNewline(text))
    }
  }

  const nextState: VscodeSettingsState = {
    managedPaths: [...managedSet].sort((a, b) => a.localeCompare(b))
  }
  if (!equalState(state, nextState)) {
    changed.push(relativePath(projectRoot, statePath))
    if (!check) {
      await writeJsonAtomic(statePath, nextState)
    }
  }
}

export async function loadVscodeSettingsState(statePath: string): Promise<VscodeSettingsState> {
  if (!(await pathExists(statePath))) {
    return DEFAULT_STATE
  }

  try {
    const parsed = await readJson<VscodeSettingsState>(statePath)
    return {
      managedPaths: Array.isArray(parsed.managedPaths) ? [...new Set(parsed.managedPaths)] : []
    }
  } catch {
    return DEFAULT_STATE
  }
}

export async function cleanupVscodeSettingsIfManaged(args: {
  settingsPath: string
  statePath: string
}): Promise<boolean> {
  const { settingsPath, statePath } = args
  const state = await loadVscodeSettingsState(statePath)
  if (state.managedPaths.length === 0) {
    return false
  }
  if (!(await pathExists(settingsPath))) {
    await removeIfExists(statePath)
    return false
  }

  const raw = await readFile(settingsPath, 'utf8')
  const parseErrors: ParseError[] = []
  const parsed = parse(raw, parseErrors, {
    allowTrailingComma: true,
    disallowComments: false
  })
  if (parseErrors.length > 0 || !isObject(parsed)) {
    return false
  }

  if (!hasOnlyManagedExcludes(parsed, new Set(state.managedPaths))) {
    return false
  }

  await removeIfExists(settingsPath)
  await removeIfExists(statePath)
  return true
}

export async function validateVscodeSettingsParse(settingsPath: string): Promise<boolean> {
  if (!(await pathExists(settingsPath))) {
    return true
  }

  const raw = await readFile(settingsPath, 'utf8')
  const parseErrors: ParseError[] = []
  parse(raw, parseErrors, {
    allowTrailingComma: true,
    disallowComments: false
  })
  return parseErrors.length === 0
}

async function loadState(statePath: string, warnings: string[]): Promise<VscodeSettingsState> {
  if (!(await pathExists(statePath))) {
    return DEFAULT_STATE
  }

  try {
    const parsed = await readJson<VscodeSettingsState>(statePath)
    return {
      managedPaths: Array.isArray(parsed.managedPaths) ? [...new Set(parsed.managedPaths)] : []
    }
  } catch {
    warnings.push('Invalid VS Code settings state file, recreating.')
    return DEFAULT_STATE
  }
}

function applyModify(text: string, path: (string | number)[], value: unknown): string {
  const edits = modify(
    text,
    path,
    value,
    {
      formattingOptions: {
        insertSpaces: true,
        tabSize: 2
      }
    },
  )
  return edits.length === 0 ? text : applyEdits(text, edits)
}

function cleanupEmptyObject(text: string, key: string): string {
  const parseErrors: ParseError[] = []
  const parsed = parse(text, parseErrors, {
    allowTrailingComma: true,
    disallowComments: false
  })
  if (parseErrors.length > 0 || !isObject(parsed)) {
    return text
  }

  const value = parsed[key]
  if (isObject(value) && Object.keys(value).length === 0) {
    return applyModify(text, [key], undefined)
  }

  return text
}

function asObject(value: unknown): Record<string, unknown> {
  return isObject(value) ? value : {}
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOnlyManagedExcludes(settings: Record<string, unknown>, managed: Set<string>): boolean {
  const allowedTopLevel = new Set(['files.exclude', 'search.exclude'])
  const topLevelKeys = Object.keys(settings)
  for (const key of topLevelKeys) {
    if (!allowedTopLevel.has(key)) return false
  }

  for (const field of ['files.exclude', 'search.exclude']) {
    const value = settings[field]
    if (!isObject(value)) {
      if (value === undefined) continue
      return false
    }
    for (const [key, entry] of Object.entries(value)) {
      if (!managed.has(key)) return false
      if (entry !== true) return false
    }
  }

  return true
}

function ensureTrailingNewline(text: string): string {
  return text.endsWith('\n') ? text : `${text}\n`
}

function equalState(a: VscodeSettingsState, b: VscodeSettingsState): boolean {
  if (a.managedPaths.length !== b.managedPaths.length) return false
  for (let i = 0; i < a.managedPaths.length; i += 1) {
    if (a.managedPaths[i] !== b.managedPaths[i]) return false
  }
  return true
}

function relativePath(projectRoot: string, absolutePath: string): string {
  return path.relative(projectRoot, absolutePath) || absolutePath
}
