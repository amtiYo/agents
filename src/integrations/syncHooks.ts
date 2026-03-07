import path from 'node:path'
import { pathExists, readJson, removeIfExists } from '../core/fs.js'
import { toChangedEntry, writeManagedFile } from '../core/managedFiles.js'
import { getAntigravityGlobalMcpPath, normalizeAntigravityMcpPayload, readAntigravityMcp } from '../core/antigravity.js'
import { getWindsurfGlobalMcpPath, normalizeWindsurfMcpPayload } from '../core/windsurf.js'
import { normalizeOpencodeConfig } from '../core/opencode.js'
import { renderVscodeMcp } from '../core/renderers.js'
import { buildAntigravityPayload } from './antigravity.js'
import { buildCodexConfig } from './codex.js'
import { buildVscodeMcpPayload } from './copilotVscode.js'
import { buildCursorPayload } from './cursor.js'
import { buildGeminiPayload } from './gemini.js'
import { buildOpencodePayload } from './opencode.js'
import { buildWindsurfPayload } from './windsurf.js'
import type { ProjectPaths } from '../core/paths.js'
import type { AgentsConfig, IntegrationName, ResolvedMcpServer } from '../types.js'

interface BuildGeneratedResult {
  content: string
  warnings: string[]
}

interface HookContext {
  projectRoot: string
  paths: ProjectPaths
  check: boolean
  changed: string[]
  warnings: string[]
  config: AgentsConfig
  generatedByIntegration: Partial<Record<IntegrationName, string>>
}

export interface IntegrationSyncHook {
  id: IntegrationName
  generatedPath: (paths: ProjectPaths) => string
  buildGenerated: (servers: ResolvedMcpServer[]) => BuildGeneratedResult
  shouldMaterialize?: (config: AgentsConfig) => boolean
  materialize?: (context: HookContext) => Promise<void>
}

export const INTEGRATION_SYNC_HOOKS: IntegrationSyncHook[] = [
  {
    id: 'codex',
    generatedPath: (paths) => paths.generatedCodex,
    buildGenerated: (servers) => {
      const codex = buildCodexConfig(servers)
      return {
        content: codex.content,
        warnings: codex.warnings
      }
    },
    materialize: async (context) => {
      const content = context.generatedByIntegration.codex ?? ''
      const targetPath = context.paths.codexConfig
      await writeManagedFile({
        absolutePath: targetPath,
        content,
        projectRoot: path.dirname(path.dirname(targetPath)),
        check: context.check,
        changed: context.changed
      })
    }
  },
  {
    id: 'gemini',
    generatedPath: (paths) => paths.generatedGemini,
    buildGenerated: (servers) => {
      const gemini = buildGeminiPayload(servers)
      return {
        content: `${JSON.stringify(gemini.payload, null, 2)}\n`,
        warnings: gemini.warnings
      }
    },
    materialize: async (context) => {
      const targetPath = context.paths.geminiSettings
      const rawGenerated = context.generatedByIntegration.gemini ?? ''
      let generated: Record<string, unknown> = {}
      if (rawGenerated.trim()) {
        generated = parseJsonObject(rawGenerated, 'generated Gemini config')
      }

      let existing: Record<string, unknown> = {}
      if (await pathExists(targetPath)) {
        try {
          existing = await readJson<Record<string, unknown>>(targetPath)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          context.warnings.push(`Failed to read existing Gemini config at ${targetPath}; starting fresh. ${message}`)
          existing = {}
        }
      }

      const merged: Record<string, unknown> = {
        ...existing,
        context: {
          ...(typeof existing.context === 'object' && existing.context !== null
            ? (existing.context as Record<string, unknown>)
            : {}),
          fileName: 'AGENTS.md'
        },
        contextFileName: generated.contextFileName,
        mcpServers: generated.mcpServers
      }

      await writeManagedFile({
        absolutePath: targetPath,
        content: `${JSON.stringify(merged, null, 2)}\n`,
        projectRoot: path.dirname(path.dirname(targetPath)),
        check: context.check,
        changed: context.changed
      })
    }
  },
  {
    id: 'copilot_vscode',
    generatedPath: (paths) => paths.generatedCopilot,
    buildGenerated: (servers) => {
      const copilot = buildVscodeMcpPayload(servers)
      return {
        content: `${JSON.stringify(copilot.payload, null, 2)}\n`,
        warnings: copilot.warnings
      }
    },
    materialize: async (context) => {
      const targetPath = context.paths.vscodeMcp
      const content = context.generatedByIntegration.copilot_vscode ?? ''
      await writeManagedFile({
        absolutePath: targetPath,
        content,
        projectRoot: path.dirname(path.dirname(targetPath)),
        check: context.check,
        changed: context.changed
      })
    }
  },
  {
    id: 'cursor',
    generatedPath: (paths) => paths.generatedCursor,
    buildGenerated: (servers) => {
      const cursor = buildCursorPayload(servers)
      return {
        content: `${JSON.stringify(cursor.payload, null, 2)}\n`,
        warnings: cursor.warnings
      }
    },
    materialize: async (context) => {
      const targetPath = context.paths.cursorMcp
      const content = context.generatedByIntegration.cursor ?? ''
      await writeManagedFile({
        absolutePath: targetPath,
        content,
        projectRoot: path.dirname(path.dirname(targetPath)),
        check: context.check,
        changed: context.changed
      })
    }
  },
  {
    id: 'antigravity',
    generatedPath: (paths) => paths.generatedAntigravity,
    buildGenerated: (servers) => {
      const antigravity = buildAntigravityPayload(servers)
      return {
        content: `${JSON.stringify(antigravity.payload, null, 2)}\n`,
        warnings: antigravity.warnings
      }
    },
    materialize: async (context) => {
      const rawGenerated = context.generatedByIntegration.antigravity ?? ''
      const legacyProjectPath = context.paths.antigravityProjectMcp
      const globalPath = getAntigravityGlobalMcpPath()
      const globalSyncEnabled = context.config.integrations.options.antigravityGlobalSync !== false

      if (!globalSyncEnabled) {
        if (await pathExists(globalPath)) {
          context.changed.push(toChangedEntry(context.projectRoot, globalPath))
          if (!context.check) {
            await removeIfExists(globalPath)
          }
        }
        return
      }

      let normalized: Record<string, unknown> = {}
      if (rawGenerated.trim().length > 0) {
        normalized = normalizeAntigravityMcpPayload(parseJsonObject(rawGenerated, 'generated Antigravity config'))
      }

      const legacyExists = await pathExists(legacyProjectPath)
      const globalExists = await pathExists(globalPath)
      if (legacyExists && !globalExists) {
        context.warnings.push(`Found legacy .antigravity/mcp.json. Antigravity now uses global MCP at ${globalPath}.`)
      }

      if (legacyExists && globalExists) {
        try {
          const [legacy, global] = await Promise.all([
            readAntigravityMcp(legacyProjectPath),
            readAntigravityMcp(globalPath)
          ])
          if (legacy && global) {
            const normalizedLegacy = JSON.stringify(normalizeAntigravityMcpPayload(legacy))
            const normalizedGlobal = JSON.stringify(normalizeAntigravityMcpPayload(global))
            if (normalizedLegacy !== normalizedGlobal) {
              context.warnings.push(`Legacy .antigravity/mcp.json differs from global Antigravity MCP (${globalPath}); local file is ignored.`)
            }
          }
        } catch (error) {
          context.warnings.push(
            `Could not compare legacy .antigravity/mcp.json with global Antigravity MCP: ${error instanceof Error ? error.message : String(error)}`,
          )
        }
      }

      await writeManagedFile({
        absolutePath: globalPath,
        content: `${JSON.stringify(normalized, null, 2)}\n`,
        projectRoot: context.projectRoot,
        check: context.check,
        changed: context.changed
      })
    }
  },
  {
    id: 'windsurf',
    generatedPath: (paths) => paths.generatedWindsurf,
    buildGenerated: (servers) => {
      const windsurf = buildWindsurfPayload(servers)
      return {
        content: `${JSON.stringify(windsurf.payload, null, 2)}\n`,
        warnings: windsurf.warnings
      }
    },
    materialize: async (context) => {
      const rawGenerated = context.generatedByIntegration.windsurf ?? ''
      const globalPath = getWindsurfGlobalMcpPath()

      let normalized: Record<string, unknown> = {}
      if (rawGenerated.trim().length > 0) {
        normalized = normalizeWindsurfMcpPayload(parseJsonObject(rawGenerated, 'generated Windsurf config'))
      }

      await writeManagedFile({
        absolutePath: globalPath,
        content: `${JSON.stringify(normalized, null, 2)}\n`,
        projectRoot: context.projectRoot,
        check: context.check,
        changed: context.changed
      })
    }
  },
  {
    id: 'opencode',
    generatedPath: (paths) => paths.generatedOpencode,
    buildGenerated: (servers) => {
      const opencode = buildOpencodePayload(servers)
      return {
        content: `${JSON.stringify(opencode.payload, null, 2)}\n`,
        warnings: opencode.warnings
      }
    },
    materialize: async (context) => {
      const targetPath = context.paths.opencodeConfig
      const rawGenerated = context.generatedByIntegration.opencode ?? ''

      let generated: Record<string, unknown> = {}
      if (rawGenerated.trim()) {
        generated = parseJsonObject(rawGenerated, 'generated OpenCode config')
      }

      let existing: Record<string, unknown> = {}
      if (await pathExists(targetPath)) {
        try {
          existing = await readJson<Record<string, unknown>>(targetPath)
        } catch (error) {
          context.warnings.push(
            `Failed to read existing OpenCode config at ${targetPath}; starting fresh. ${error instanceof Error ? error.message : String(error)}`,
          )
          existing = {}
        }
      }

      const generatedMcp = typeof generated.mcp === 'object' && generated.mcp !== null && !Array.isArray(generated.mcp)
        ? generated.mcp as Record<string, unknown>
        : {}

      const merged = normalizeOpencodeConfig({
        ...existing,
        mcp: generatedMcp
      })

      await writeManagedFile({
        absolutePath: targetPath,
        content: `${JSON.stringify(merged, null, 2)}\n`,
        projectRoot: context.projectRoot,
        check: context.check,
        changed: context.changed
      })
    }
  },
  {
    id: 'claude',
    generatedPath: (paths) => paths.generatedClaude,
    buildGenerated: (servers) => {
      const claude = renderVscodeMcp(servers)
      return {
        content: `${JSON.stringify({ mcpServers: claude.servers }, null, 2)}\n`,
        warnings: claude.warnings
      }
    }
  }
]

function parseJsonObject(raw: string, label: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch (error) {
    throw new Error(`Failed to parse ${label}: ${error instanceof Error ? error.message : String(error)}`)
  }
}
