import path from 'node:path'

export interface ProjectPaths {
  root: string
  agentsDir: string
  agentsConfig: string
  agentsLocal: string
  rootAgentsMd: string
  agentsReadme: string
  agentsSkillsDir: string
  generatedDir: string
  generatedCodex: string
  generatedGemini: string
  generatedCopilot: string
  generatedCursor: string
  generatedAntigravity: string
  generatedClaude: string
  generatedClaudeState: string
  generatedCursorState: string
  generatedSkillsState: string
  generatedVscodeSettingsState: string
  codexConfig: string
  geminiSettings: string
  vscodeMcp: string
  vscodeSettings: string
  cursorMcp: string
  antigravityProjectMcp: string
  codexDir: string
  geminiDir: string
  vscodeDir: string
  cursorDir: string
  antigravityDir: string
  claudeDir: string
  geminiSkillsBridge: string
  claudeSkillsBridge: string
  cursorSkillsBridge: string
}

export function getProjectPaths(projectRoot: string): ProjectPaths {
  const root = path.resolve(projectRoot)
  const agentsDir = path.join(root, '.agents')
  const generatedDir = path.join(agentsDir, 'generated')

  return {
    root,
    agentsDir,
    agentsConfig: path.join(agentsDir, 'agents.json'),
    agentsLocal: path.join(agentsDir, 'local.json'),
    rootAgentsMd: path.join(root, 'AGENTS.md'),
    agentsReadme: path.join(agentsDir, 'README.md'),
    agentsSkillsDir: path.join(agentsDir, 'skills'),
    generatedDir,
    generatedCodex: path.join(generatedDir, 'codex.config.toml'),
    generatedGemini: path.join(generatedDir, 'gemini.settings.json'),
    generatedCopilot: path.join(generatedDir, 'copilot.vscode.mcp.json'),
    generatedCursor: path.join(generatedDir, 'cursor.mcp.json'),
    generatedAntigravity: path.join(generatedDir, 'antigravity.mcp.json'),
    generatedClaude: path.join(generatedDir, 'claude.mcp.json'),
    generatedClaudeState: path.join(generatedDir, 'claude.state.json'),
    generatedCursorState: path.join(generatedDir, 'cursor.state.json'),
    generatedSkillsState: path.join(generatedDir, 'skills.state.json'),
    generatedVscodeSettingsState: path.join(generatedDir, 'vscode.settings.state.json'),
    codexConfig: path.join(root, '.codex', 'config.toml'),
    geminiSettings: path.join(root, '.gemini', 'settings.json'),
    vscodeMcp: path.join(root, '.vscode', 'mcp.json'),
    vscodeSettings: path.join(root, '.vscode', 'settings.json'),
    cursorMcp: path.join(root, '.cursor', 'mcp.json'),
    antigravityProjectMcp: path.join(root, '.antigravity', 'mcp.json'),
    codexDir: path.join(root, '.codex'),
    geminiDir: path.join(root, '.gemini'),
    vscodeDir: path.join(root, '.vscode'),
    cursorDir: path.join(root, '.cursor'),
    antigravityDir: path.join(root, '.antigravity'),
    claudeDir: path.join(root, '.claude'),
    geminiSkillsBridge: path.join(root, '.gemini', 'skills'),
    claudeSkillsBridge: path.join(root, '.claude', 'skills'),
    cursorSkillsBridge: path.join(root, '.cursor', 'skills')
  }
}
