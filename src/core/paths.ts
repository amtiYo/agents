import path from 'node:path'

export interface ProjectPaths {
  root: string
  agentsDir: string
  agentsConfig: string
  agentsLocal: string
  rootAgentsMd: string
  rootClaudeMd: string
  agentsReadme: string
  agentsSkillsDir: string
  agentsRulesDir: string
  generatedDir: string
  generatedCodex: string
  generatedGemini: string
  generatedCopilot: string
  generatedCopilotCli: string
  generatedCursor: string
  generatedAntigravity: string
  generatedAntigravityState: string
  generatedWindsurf: string
  generatedWindsurfState: string
  generatedOpencode: string
  generatedClaude: string
  generatedClaudeDesktop: string
  generatedClaudeDesktopState: string
  generatedClaudeState: string
  generatedClaudeInstructionsState: string
  generatedCursorState: string
  generatedCursorRulesState: string
  generatedClaudeRulesState: string
  generatedWindsurfRulesState: string
  generatedCopilotRulesState: string
  generatedSkillsState: string
  generatedVscodeSettingsState: string
  generatedSyncLock: string
  codexConfig: string
  geminiSettings: string
  vscodeMcp: string
  copilotCliMcp: string
  vscodeSettings: string
  cursorMcp: string
  antigravityWorkspaceMcp: string
  antigravityProjectMcp: string
  opencodeConfig: string
  codexDir: string
  geminiDir: string
  vscodeDir: string
  cursorDir: string
  antigravityDir: string
  windsurfDir: string
  opencodeDir: string
  claudeDir: string
  generatedJunie: string
  junieDir: string
  junieMcpDir: string
  junieMcp: string
  junieSkillsBridge: string
  geminiSkillsBridge: string
  claudeSkillsBridge: string
  cursorSkillsBridge: string
  windsurfSkillsBridge: string
  cursorRulesDir: string
  claudeRulesDir: string
  windsurfRulesDir: string
  copilotInstructionsDir: string
}

/**
 * Construct a complete set of filesystem paths for a project based on the given project root.
 *
 * @param projectRoot - Path to the project root (will be resolved to an absolute path)
 * @returns An object mapping canonical absolute paths for agent configuration, generated outputs, editor/tool configuration, Antigravity and Junie integration, and various skills/bridge directories
 */
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
    rootClaudeMd: path.join(root, 'CLAUDE.md'),
    agentsReadme: path.join(agentsDir, 'README.md'),
    agentsSkillsDir: path.join(agentsDir, 'skills'),
    agentsRulesDir: path.join(agentsDir, 'rules'),
    generatedDir,
    generatedCodex: path.join(generatedDir, 'codex.config.toml'),
    generatedGemini: path.join(generatedDir, 'gemini.settings.json'),
    generatedCopilot: path.join(generatedDir, 'copilot.vscode.mcp.json'),
    generatedCopilotCli: path.join(generatedDir, 'copilot.cli.mcp.json'),
    generatedCursor: path.join(generatedDir, 'cursor.mcp.json'),
    generatedAntigravity: path.join(generatedDir, 'antigravity.mcp_config.json'),
    generatedAntigravityState: path.join(generatedDir, 'antigravity.state.json'),
    generatedWindsurf: path.join(generatedDir, 'windsurf.mcp.json'),
    generatedWindsurfState: path.join(generatedDir, 'windsurf.state.json'),
    generatedOpencode: path.join(generatedDir, 'opencode.json'),
    generatedClaude: path.join(generatedDir, 'claude.mcp.json'),
    generatedClaudeDesktop: path.join(generatedDir, 'claude-desktop.mcp.json'),
    generatedClaudeDesktopState: path.join(generatedDir, 'claude-desktop.state.json'),
    generatedClaudeState: path.join(generatedDir, 'claude.state.json'),
    generatedClaudeInstructionsState: path.join(generatedDir, 'claude.instructions.state.json'),
    generatedCursorState: path.join(generatedDir, 'cursor.state.json'),
    generatedCursorRulesState: path.join(generatedDir, 'cursor.rules.state.json'),
    generatedClaudeRulesState: path.join(generatedDir, 'claude.rules.state.json'),
    generatedWindsurfRulesState: path.join(generatedDir, 'windsurf.rules.state.json'),
    generatedCopilotRulesState: path.join(generatedDir, 'copilot.rules.state.json'),
    generatedSkillsState: path.join(generatedDir, 'skills.state.json'),
    generatedVscodeSettingsState: path.join(generatedDir, 'vscode.settings.state.json'),
    generatedSyncLock: path.join(generatedDir, 'sync.lock'),
    codexConfig: path.join(root, '.codex', 'config.toml'),
    geminiSettings: path.join(root, '.gemini', 'settings.json'),
    vscodeMcp: path.join(root, '.vscode', 'mcp.json'),
    copilotCliMcp: path.join(root, '.mcp.json'),
    vscodeSettings: path.join(root, '.vscode', 'settings.json'),
    cursorMcp: path.join(root, '.cursor', 'mcp.json'),
    antigravityWorkspaceMcp: path.join(agentsDir, 'mcp_config.json'),
    antigravityProjectMcp: path.join(root, '.antigravity', 'mcp.json'),
    opencodeConfig: path.join(root, 'opencode.json'),
    codexDir: path.join(root, '.codex'),
    geminiDir: path.join(root, '.gemini'),
    vscodeDir: path.join(root, '.vscode'),
    cursorDir: path.join(root, '.cursor'),
    antigravityDir: path.join(root, '.antigravity'),
    windsurfDir: path.join(root, '.windsurf'),
    opencodeDir: path.join(root, '.opencode'),
    claudeDir: path.join(root, '.claude'),
    generatedJunie: path.join(generatedDir, 'junie.mcp.json'),
    junieDir: path.join(root, '.junie'),
    junieMcpDir: path.join(root, '.junie', 'mcp'),
    junieMcp: path.join(root, '.junie', 'mcp', 'mcp.json'),
    junieSkillsBridge: path.join(root, '.junie', 'skills'),
    geminiSkillsBridge: path.join(root, '.gemini', 'skills'),
    claudeSkillsBridge: path.join(root, '.claude', 'skills'),
    cursorSkillsBridge: path.join(root, '.cursor', 'skills'),
    windsurfSkillsBridge: path.join(root, '.windsurf', 'skills'),
    cursorRulesDir: path.join(root, '.cursor', 'rules'),
    claudeRulesDir: path.join(root, '.claude', 'rules'),
    windsurfRulesDir: path.join(root, '.windsurf', 'rules'),
    copilotInstructionsDir: path.join(root, '.github', 'instructions')
  }
}
