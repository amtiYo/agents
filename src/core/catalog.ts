import path from 'node:path'
import { CATALOG_SCHEMA_VERSION } from '../types.js'
import type { CatalogFile } from '../types.js'
import { ensureDir, pathExists, readJson, writeJsonAtomic } from './fs.js'
import { getCatalogPath } from './paths.js'

const DEFAULT_CATALOG: CatalogFile = {
  schemaVersion: CATALOG_SCHEMA_VERSION,
  mcpPresets: [
    {
      id: 'safe-core',
      label: 'Safe core',
      description: 'filesystem + fetch + git',
      serverIds: ['filesystem', 'fetch', 'git']
    },
    {
      id: 'minimal',
      label: 'Minimal',
      description: 'filesystem only',
      serverIds: ['filesystem']
    },
    {
      id: 'dev-full',
      label: 'Dev full',
      description: 'filesystem + fetch + git + playwright + context7',
      serverIds: ['filesystem', 'fetch', 'git', 'playwright', 'context7']
    }
  ],
  mcpServers: {
    filesystem: {
      label: 'Filesystem',
      description: 'Read and write files in the current project',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '${PROJECT_ROOT}'],
      targets: ['codex', 'claude', 'gemini', 'copilot_vscode', 'cursor', 'antigravity'],
      enabled: true
    },
    fetch: {
      label: 'Fetch',
      description: 'HTTP fetching and scraping helpers',
      transport: 'stdio',
      command: 'uvx',
      args: ['mcp-server-fetch'],
      env: {
        FASTMCP_LOG_LEVEL: 'ERROR'
      },
      targets: ['codex', 'claude', 'gemini', 'copilot_vscode', 'cursor', 'antigravity'],
      enabled: true
    },
    git: {
      label: 'Git',
      description: 'Repository-aware git operations',
      transport: 'stdio',
      command: 'uvx',
      args: ['mcp-server-git', '--repository', '${PROJECT_ROOT}'],
      env: {
        FASTMCP_LOG_LEVEL: 'ERROR'
      },
      targets: ['codex', 'claude', 'gemini', 'copilot_vscode', 'cursor', 'antigravity'],
      enabled: true
    },
    playwright: {
      label: 'Playwright',
      description: 'Browser automation for UI checks',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@playwright/mcp@latest'],
      targets: ['codex', 'claude', 'gemini', 'copilot_vscode', 'cursor', 'antigravity'],
      enabled: true
    },
    context7: {
      label: 'Context7',
      description: 'Context7 docs and snippets search',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@upstash/context7-mcp', '--api-key', '${CONTEXT7_API_KEY}'],
      requiredEnv: ['CONTEXT7_API_KEY'],
      targets: ['codex', 'claude', 'gemini', 'copilot_vscode', 'cursor', 'antigravity'],
      enabled: true
    }
  },
  skillPacks: [
    {
      id: 'skills-starter',
      label: 'Skills Starter',
      description: 'Baseline guide for creating and using project skills',
      skillIds: ['skills-authoring-guide']
    },
    {
      id: 'core-dev',
      label: 'Core Dev',
      description: 'General software engineering workflow skills',
      skillIds: ['code-review-baseline', 'delivery-checklist']
    }
  ],
  skills: {
    'skills-authoring-guide': {
      name: 'skills-authoring-guide',
      description: 'Explain how to structure, create, and maintain SKILL.md entries in this repository.',
      instructions:
        'When asked about skills, explain folder layout under .agents/skills, required SKILL.md frontmatter, and progressive disclosure principles. Provide a minimal template and checklist.'
    },
    'code-review-baseline': {
      name: 'code-review-baseline',
      description: 'Apply a strict bug-first review checklist when the user asks for a review.',
      instructions:
        'Review code by severity. Prioritize correctness, regressions, and missing tests. Keep summary short and list concrete findings first.'
    },
    'delivery-checklist': {
      name: 'delivery-checklist',
      description: 'Run a final delivery checklist before reporting task completion.',
      instructions:
        'Before final response, verify lint/build/tests where applicable, mention what could not be validated, and provide concise next steps.'
    },
    'frontend-smoke': {
      name: 'frontend-smoke',
      description: 'Use browser automation for UI smoke checks when frontend files change.',
      instructions:
        'For UI tasks, run a visual smoke check on desktop and mobile widths, verify key CTA and no overflow/overlap issues.'
    }
  }
}

export function getDefaultCatalog(): CatalogFile {
  return JSON.parse(JSON.stringify(DEFAULT_CATALOG)) as CatalogFile
}

export async function ensureGlobalCatalog(): Promise<{ path: string; catalog: CatalogFile; created: boolean }> {
  const catalogPath = getCatalogPath()
  if (await pathExists(catalogPath)) {
    const existing = await readJson<CatalogFile>(catalogPath)
    validateCatalog(existing)
    return { path: catalogPath, catalog: existing, created: false }
  }

  await ensureDir(path.dirname(catalogPath))
  const catalog = getDefaultCatalog()
  await writeJsonAtomic(catalogPath, catalog)
  return { path: catalogPath, catalog, created: true }
}

export function validateCatalog(catalog: CatalogFile): void {
  if (catalog.schemaVersion !== CATALOG_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported catalog schema version ${String(catalog.schemaVersion)}. Expected ${String(CATALOG_SCHEMA_VERSION)}.`,
    )
  }

  if (!Array.isArray(catalog.mcpPresets) || typeof catalog.mcpServers !== 'object') {
    throw new Error('Invalid catalog structure: missing mcpPresets or mcpServers.')
  }
}
