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
  // Deleting the last key of a document renders it as `{}` and takes the comments
  // attached to that key with it. Those comments are the user's, so they are read
  // before the deletion and returned on their own when nothing else is left.
  const leadingComment = Object.keys(extensions).length === 0 ? readLeadingComment(doc) : ''

  if (Object.keys(extensions).length === 0) {
    doc.delete('extensions')
  } else {
    doc.set('extensions', doc.createNode(extensions))
  }
  const rendered = doc.toString({ lineWidth: 0 })
  if (rendered === '{}\n' || rendered.trim() === 'null') {
    return leadingComment
  }
  return rendered
}

/** Comment lines that sit above the document or above its `extensions` key. */
function readLeadingComment(doc: YAML.Document.Parsed): string {
  const parts: string[] = []
  if (typeof doc.commentBefore === 'string') parts.push(doc.commentBefore)

  const contents = doc.contents
  if (YAML.isMap(contents)) {
    for (const item of contents.items) {
      const key: unknown = item.key
      const isExtensions =
        typeof key === 'object' && key !== null && 'value' in key && (key as { value: unknown }).value === 'extensions'
      if (!isExtensions) continue
      const comment = (key as { commentBefore?: unknown }).commentBefore
      if (typeof comment === 'string') parts.push(comment)
      break
    }
  }

  if (parts.length === 0) return ''
  return `${parts
    .join('\n')
    .split('\n')
    .map((line) => `#${line}`)
    .join('\n')}\n`
}

/** Write the Goose config, creating `~/.config/goose` when it does not exist. */
export async function writeGooseConfig(configPath: string, content: string): Promise<void> {
  await ensureDir(path.dirname(configPath))
  await writeTextAtomic(configPath, content)
}
