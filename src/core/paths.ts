import os from 'node:os'
import path from 'node:path'

export interface ProjectPaths {
  root: string
  isHome: boolean
  agentsDir: string
  agentsConfig: string
  agentsLocal: string
  rootAgentsMd: string
  rootClaudeMd: string
  agentsReadme: string
  agentsSkillsDir: string
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
}

/** Resolve the effective user home directory, honoring AGENTS_HOME_DIR in test/override environments. */
export function getHomeDir(): string {
  const override = process.env.AGENTS_HOME_DIR
  if (override && override.trim().length > 0) {
    return path.resolve(override.trim())
  }
  return os.homedir()
}

/** Check whether a target path refers to the user's home directory. */
export function isHomeDirectory(targetPath: string, homeDir = getHomeDir()): boolean {
  const resolvedTarget = path.resolve(targetPath)
  const resolvedHome = path.resolve(homeDir)
  return process.platform === 'win32'
    ? resolvedTarget.toLowerCase() === resolvedHome.toLowerCase()
    : resolvedTarget === resolvedHome
}

/** Convert an absolute path to a home-relative display label (`~/...`) when inside the home directory. */
export function toHomeRelativePath(filePath: string, homeDir = getHomeDir()): string {
  const home = path.resolve(homeDir)
  const relative = path.relative(home, filePath)
  if (relative.length === 0) return '~'
  if (relative.startsWith('..') || path.isAbsolute(relative)) return filePath
  return path.join('~', relative)
}

/** Resolve OpenCode's global configuration directory (`~/.config/opencode` or `$XDG_CONFIG_HOME/opencode`). */
export function getOpencodeGlobalConfigDir(homeDir = getHomeDir()): string {
  const xdg = process.env.XDG_CONFIG_HOME
  if (xdg && xdg.trim().length > 0) {
    return path.join(path.resolve(xdg.trim()), 'opencode')
  }
  return path.join(path.resolve(homeDir), '.config', 'opencode')
}

/** Resolve OpenCode's global configuration file (`opencode.json`). */
export function getOpencodeGlobalConfigPath(homeDir = getHomeDir()): string {
  const override = process.env.AGENTS_OPENCODE_CONFIG_PATH
  if (override && override.trim().length > 0) {
    return path.resolve(override.trim())
  }
  return path.join(getOpencodeGlobalConfigDir(homeDir), 'opencode.json')
}

/**
 * Resolve OpenCode configuration file path for a project or global home root.
 *
 * In project mode, resolves to `<projectRoot>/opencode.json`.
 * In global mode (`projectRoot` is `$HOME`), resolves to `~/.config/opencode/opencode.json` (or `$XDG_CONFIG_HOME/opencode/opencode.json`).
 */
export function getOpencodeConfigPath(projectRoot: string, homeDir = getHomeDir()): string {
  const override = process.env.AGENTS_OPENCODE_CONFIG_PATH
  if (override && override.trim().length > 0) {
    return path.resolve(override.trim())
  }
  const root = path.resolve(projectRoot)
  if (isHomeDirectory(root, homeDir)) {
    return getOpencodeGlobalConfigPath(homeDir)
  }
  return path.join(root, 'opencode.json')
}

/**
 * Resolve OpenCode tool directory for a project or global home root.
 *
 * In project mode, resolves to `<projectRoot>/.opencode`.
 * In global mode (`projectRoot` is `$HOME`), resolves to `~/.config/opencode` (or `$XDG_CONFIG_HOME/opencode`).
 */
export function getOpencodeDir(projectRoot: string, homeDir = getHomeDir()): string {
  const root = path.resolve(projectRoot)
  if (isHomeDirectory(root, homeDir)) {
    return getOpencodeGlobalConfigDir(homeDir)
  }
  return path.join(root, '.opencode')
}

/**
 * Construct a complete set of filesystem paths for a project based on the given project root.
 *
 * @param projectRoot - Path to the project root (will be resolved to an absolute path)
 * @returns An object mapping canonical absolute paths for agent configuration, generated outputs, editor/tool configuration, Antigravity and Junie integration, and various skills/bridge directories
 */
export function getProjectPaths(projectRoot: string): ProjectPaths {
  const root = path.resolve(projectRoot)
  const homeDir = getHomeDir()
  const isHome = isHomeDirectory(root, homeDir)
  const agentsDir = path.join(root, '.agents')
  const generatedDir = path.join(agentsDir, 'generated')

  return {
    root,
    isHome,
    agentsDir,
    agentsConfig: path.join(agentsDir, 'agents.json'),
    agentsLocal: path.join(agentsDir, 'local.json'),
    rootAgentsMd: path.join(root, 'AGENTS.md'),
    rootClaudeMd: path.join(root, 'CLAUDE.md'),
    agentsReadme: path.join(agentsDir, 'README.md'),
    agentsSkillsDir: path.join(agentsDir, 'skills'),
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
    opencodeConfig: getOpencodeConfigPath(root, homeDir),
    codexDir: path.join(root, '.codex'),
    geminiDir: path.join(root, '.gemini'),
    vscodeDir: path.join(root, '.vscode'),
    cursorDir: path.join(root, '.cursor'),
    antigravityDir: path.join(root, '.antigravity'),
    windsurfDir: path.join(root, '.windsurf'),
    opencodeDir: getOpencodeDir(root, homeDir),
    claudeDir: path.join(root, '.claude'),
    generatedJunie: path.join(generatedDir, 'junie.mcp.json'),
    junieDir: path.join(root, '.junie'),
    junieMcpDir: path.join(root, '.junie', 'mcp'),
    junieMcp: path.join(root, '.junie', 'mcp', 'mcp.json'),
    junieSkillsBridge: path.join(root, '.junie', 'skills'),
    geminiSkillsBridge: path.join(root, '.gemini', 'skills'),
    claudeSkillsBridge: path.join(root, '.claude', 'skills'),
    cursorSkillsBridge: path.join(root, '.cursor', 'skills'),
    windsurfSkillsBridge: path.join(root, '.windsurf', 'skills')
  }
}
