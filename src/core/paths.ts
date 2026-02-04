import os from 'node:os'
import path from 'node:path'

export interface ProjectPaths {
  root: string
  agentsDir: string
  agentsProject: string
  agentsMd: string
  rootAgentsMd: string
  agentsReadme: string
  agentsSkillsDir: string
  mcpDir: string
  mcpSelection: string
  mcpLocal: string
  mcpLocalExample: string
  generatedDir: string
  generatedCodex: string
  generatedGemini: string
  generatedCopilot: string
  generatedCursor: string
  generatedAntigravity: string
  generatedClaude: string
  generatedClaudeState: string
  generatedCursorState: string
  generatedAntigravityState: string
  generatedSkillsState: string
  codexConfig: string
  geminiSettings: string
  vscodeMcp: string
  cursorMcp: string
  codexDir: string
  geminiDir: string
  vscodeDir: string
  cursorDir: string
  antigravityDir: string
  claudeDir: string
  claudeSkillsBridge: string
  cursorSkillsBridge: string
}

export function getProjectPaths(projectRoot: string): ProjectPaths {
  const root = path.resolve(projectRoot)
  const agentsDir = path.join(root, '.agents')
  const mcpDir = path.join(agentsDir, 'mcp')
  const generatedDir = path.join(agentsDir, 'generated')

  return {
    root,
    agentsDir,
    agentsProject: path.join(agentsDir, 'project.json'),
    agentsMd: path.join(agentsDir, 'AGENTS.md'),
    rootAgentsMd: path.join(root, 'AGENTS.md'),
    agentsReadme: path.join(agentsDir, 'README.md'),
    agentsSkillsDir: path.join(agentsDir, 'skills'),
    mcpDir,
    mcpSelection: path.join(mcpDir, 'selection.json'),
    mcpLocal: path.join(mcpDir, 'local.json'),
    mcpLocalExample: path.join(mcpDir, 'local.example.json'),
    generatedDir,
    generatedCodex: path.join(generatedDir, 'codex.config.toml'),
    generatedGemini: path.join(generatedDir, 'gemini.settings.json'),
    generatedCopilot: path.join(generatedDir, 'copilot.vscode.mcp.json'),
    generatedCursor: path.join(generatedDir, 'cursor.mcp.json'),
    generatedAntigravity: path.join(generatedDir, 'antigravity.mcp.json'),
    generatedClaude: path.join(generatedDir, 'claude.mcp.json'),
    generatedClaudeState: path.join(generatedDir, 'claude.state.json'),
    generatedCursorState: path.join(generatedDir, 'cursor.state.json'),
    generatedAntigravityState: path.join(generatedDir, 'antigravity.state.json'),
    generatedSkillsState: path.join(generatedDir, 'skills.state.json'),
    codexConfig: path.join(root, '.codex', 'config.toml'),
    geminiSettings: path.join(root, '.gemini', 'settings.json'),
    vscodeMcp: path.join(root, '.vscode', 'mcp.json'),
    cursorMcp: path.join(root, '.cursor', 'mcp.json'),
    codexDir: path.join(root, '.codex'),
    geminiDir: path.join(root, '.gemini'),
    vscodeDir: path.join(root, '.vscode'),
    cursorDir: path.join(root, '.cursor'),
    antigravityDir: path.join(root, '.antigravity'),
    claudeDir: path.join(root, '.claude'),
    claudeSkillsBridge: path.join(root, '.claude', 'skills'),
    cursorSkillsBridge: path.join(root, '.cursor', 'skills')
  }
}

export function getCatalogPath(): string {
  const fromEnv = process.env.AGENTS_CATALOG_PATH
  if (fromEnv && fromEnv.trim().length > 0) {
    return path.resolve(fromEnv)
  }

  if (process.platform === 'win32') {
    const base = process.env.APPDATA ? path.resolve(process.env.APPDATA) : path.join(os.homedir(), 'AppData', 'Roaming')
    return path.join(base, 'agents', 'catalog.json')
  }

  return path.join(os.homedir(), '.config', 'agents', 'catalog.json')
}

export function getAntigravityUserMcpPath(): string {
  const fromEnv = process.env.AGENTS_ANTIGRAVITY_MCP_PATH
  if (fromEnv && fromEnv.trim().length > 0) {
    return path.resolve(fromEnv)
  }

  if (process.platform === 'win32') {
    const base = process.env.APPDATA ? path.resolve(process.env.APPDATA) : path.join(os.homedir(), 'AppData', 'Roaming')
    return path.join(base, 'Antigravity', 'User', 'mcp.json')
  }

  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Antigravity', 'User', 'mcp.json')
  }

  return path.join(os.homedir(), '.config', 'Antigravity', 'User', 'mcp.json')
}
