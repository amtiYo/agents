import os from 'node:os'
import path from 'node:path'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ensureGrokProjectTrusted, getGrokTrustState, getGrokTrustedFoldersPath } from '../src/core/trust.js'

const tempDirs: string[] = []
let previousTrustPath: string | undefined

async function writeTrustFile(content: string): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'agents-grok-trust-'))
  tempDirs.push(dir)
  const trustPath = path.join(dir, 'trusted_folders.toml')
  await writeFile(trustPath, content, 'utf8')
  process.env.AGENTS_GROK_TRUSTED_FOLDERS_PATH = trustPath
  return trustPath
}

beforeEach(() => {
  previousTrustPath = process.env.AGENTS_GROK_TRUSTED_FOLDERS_PATH
})

afterEach(async () => {
  if (previousTrustPath === undefined) delete process.env.AGENTS_GROK_TRUSTED_FOLDERS_PATH
  else process.env.AGENTS_GROK_TRUSTED_FOLDERS_PATH = previousTrustPath

  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    await rm(dir, { recursive: true, force: true })
  }
})

describe('grok trust', () => {
  it('reports an untrusted project and trusts it without touching other folders', async () => {
    const trustPath = await writeTrustFile(
      ['[folders."/other/project"]', 'trusted = true', 'decided_at = 1700000000', ''].join('\n'),
    )

    expect(await getGrokTrustState('/tmp/my-project')).toBe('untrusted')

    const result = await ensureGrokProjectTrusted('/tmp/my-project')
    expect(result.changed).toBe(true)
    expect(result.path).toBe(trustPath)

    const written = await readFile(trustPath, 'utf8')
    expect(written).toContain('[folders."/other/project"]')
    expect(written).toContain('decided_at = 1700000000')
    expect(written).toContain('[folders."/tmp/my-project"]')
    expect(written).toMatch(/\[folders\."\/tmp\/my-project"\]\ntrusted = true\ndecided_at = \d+/)
    expect(await getGrokTrustState('/tmp/my-project')).toBe('trusted')
  })

  it('creates the file when Grok has never recorded a decision', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'agents-grok-trust-'))
    tempDirs.push(dir)
    const trustPath = path.join(dir, 'nested', 'trusted_folders.toml')
    process.env.AGENTS_GROK_TRUSTED_FOLDERS_PATH = trustPath

    expect(getGrokTrustedFoldersPath()).toBe(trustPath)
    expect(await getGrokTrustState('/tmp/fresh-project')).toBe('untrusted')

    await ensureGrokProjectTrusted('/tmp/fresh-project')
    expect(await getGrokTrustState('/tmp/fresh-project')).toBe('trusted')
  })

  it('flips an existing entry from untrusted to trusted in place', async () => {
    const trustPath = await writeTrustFile(
      ['[folders."/tmp/my-project"]', 'trusted = false', 'decided_at = 1700000000', ''].join('\n'),
    )

    expect(await getGrokTrustState('/tmp/my-project')).toBe('untrusted')
    const result = await ensureGrokProjectTrusted('/tmp/my-project')
    expect(result.changed).toBe(true)

    const written = await readFile(trustPath, 'utf8')
    expect(written).toContain('trusted = true')
    expect(written).toContain('decided_at = 1700000000')
    expect(written).not.toContain('trusted = false')
  })

  it('does nothing when the folder is already trusted', async () => {
    const trustPath = await writeTrustFile(
      ['[folders."/tmp/my-project"]', 'trusted = true', 'decided_at = 1700000000', ''].join('\n'),
    )
    const before = await readFile(trustPath, 'utf8')

    const result = await ensureGrokProjectTrusted('/tmp/my-project')
    expect(result.changed).toBe(false)
    expect(await readFile(trustPath, 'utf8')).toBe(before)
  })

  it('reports a trust file it cannot read instead of failing', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'agents-grok-trust-'))
    tempDirs.push(dir)
    // A directory in the file's place fails the read for every user, including root,
    // which a mode of 0000 does not. The failure itself is what matters here: status and
    // doctor call this, and a rejected promise would take both down.
    const trustPath = path.join(dir, 'trusted_folders.toml')
    await mkdir(trustPath, { recursive: true })
    process.env.AGENTS_GROK_TRUSTED_FOLDERS_PATH = trustPath

    expect(await getGrokTrustState('/tmp/my-project')).toBe('unreadable')
  })

  it('never loses a decision when two projects write at the same time', async () => {
    const trustPath = await writeTrustFile('')

    // The file is read and rewritten whole, so two writers without a lock would drop one
    // of the two entries. The lock refuses the second writer rather than queueing it,
    // which is how this CLI guards every other shared file: the caller retries.
    const results = await Promise.allSettled([
      ensureGrokProjectTrusted('/tmp/project-one'),
      ensureGrokProjectTrusted('/tmp/project-two')
    ])
    const refused = results.filter((result) => result.status === 'rejected')
    expect(refused.length).toBeLessThanOrEqual(1)
    for (const rejection of refused) {
      expect(String((rejection as PromiseRejectedResult).reason)).toContain('already running')
    }

    await ensureGrokProjectTrusted('/tmp/project-one')
    await ensureGrokProjectTrusted('/tmp/project-two')

    const written = await readFile(trustPath, 'utf8')
    expect(written).toContain('[folders."/tmp/project-one"]')
    expect(written).toContain('[folders."/tmp/project-two"]')
    expect(await getGrokTrustState('/tmp/project-one')).toBe('trusted')
    expect(await getGrokTrustState('/tmp/project-two')).toBe('trusted')
  })

  it('refuses to edit a trust file Grok itself cannot parse', async () => {
    await writeTrustFile('[folders."/tmp/my-project"\ntrusted = true\n')

    expect(await getGrokTrustState('/tmp/my-project')).toBe('unreadable')
    await expect(ensureGrokProjectTrusted('/tmp/my-project')).rejects.toThrow(/not valid TOML/)
  })

  it('refuses to append when the folder is recorded in another shape', async () => {
    await writeTrustFile('folders = { "/tmp/my-project" = { trusted = false } }\n')

    await expect(ensureGrokProjectTrusted('/tmp/my-project')).rejects.toThrow(/manually/)
  })

  it('refuses to append next to an inline folders table for a different folder', async () => {
    // Appending [folders."..."] here would redefine the key and leave Grok unable to
    // read its own file, which is worse than not setting trust.
    const trustPath = await writeTrustFile('folders = { "/other/project" = { trusted = true } }\n')
    const before = await readFile(trustPath, 'utf8')

    await expect(ensureGrokProjectTrusted('/tmp/my-project')).rejects.toThrow(/manually/)
    expect(await readFile(trustPath, 'utf8')).toBe(before)
  })

  it('refuses to append when folders is an array of tables', async () => {
    const trustPath = await writeTrustFile('[[folders]]\nname = "x"\n')
    const before = await readFile(trustPath, 'utf8')

    await expect(ensureGrokProjectTrusted('/tmp/my-project')).rejects.toThrow(/does not edit/)
    expect(await readFile(trustPath, 'utf8')).toBe(before)
  })

  it('refuses to append when folders is a scalar', async () => {
    const trustPath = await writeTrustFile('folders = "nope"\n')
    const before = await readFile(trustPath, 'utf8')

    await expect(ensureGrokProjectTrusted('/tmp/my-project')).rejects.toThrow(/manually/)
    expect(await readFile(trustPath, 'utf8')).toBe(before)
  })
})
