import path from 'node:path'
import YAML from 'yaml'
import { ensureDir, pathExists, readTextOrEmpty, writeTextAtomic } from './fs.js'

export { getGooseConfigPath } from './paths.js'

/**
 * Read Goose's `config.yaml` as an editable document so comments and unrelated
 * settings (providers, model choices) survive a sync.
 */
export async function readGooseDocument(configPath: string): Promise<YAML.Document.Parsed> {
  if (!(await pathExists(configPath))) {
    return YAML.parseDocument('')
  }

  const raw = await readTextOrEmpty(configPath)
  const doc = YAML.parseDocument(raw)
  if (doc.errors.length > 0) {
    throw new Error(doc.errors[0]?.message ?? 'invalid YAML')
  }
  return doc
}

/** Extension entries currently present in a Goose document. */
export function readGooseExtensions(doc: YAML.Document.Parsed): Record<string, unknown> {
  const value = doc.toJS() as { extensions?: unknown } | null
  const extensions = value?.extensions
  return typeof extensions === 'object' && extensions !== null && !Array.isArray(extensions)
    ? (extensions as Record<string, unknown>)
    : {}
}

/** Replace the `extensions` map of a Goose document, keeping everything else intact. */
export function setGooseExtensions(doc: YAML.Document.Parsed, extensions: Record<string, unknown>): string {
  if (Object.keys(extensions).length === 0) {
    doc.delete('extensions')
  } else {
    doc.set('extensions', doc.createNode(extensions))
  }
  const rendered = doc.toString({ lineWidth: 0 })
  return rendered === '{}\n' || rendered.trim() === 'null' ? '' : rendered
}

export async function writeGooseConfig(configPath: string, content: string): Promise<void> {
  await ensureDir(path.dirname(configPath))
  await writeTextAtomic(configPath, content)
}
