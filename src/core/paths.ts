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
  generatedSyncState: string
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
  grokConfig: string
  grokDir: string
  ampSettings: string
  ampDir: string
  droidMcp: string
  droidDir: string
  kiloConfig: string
  kiloDir: string
  devinMcp: string
  devinDir: string
  zedSettings: string
  zedDir: string
  gooseConfig: string
  copilotCliGithubMcp: string
  generatedGrok: string
  generatedAmp: string
  generatedDroid: string
  generatedKilo: string
  generatedDevin: string
  generatedZed: string
  generatedGoose: string
  generatedGooseState: string
  generatedAmpState: string
  generatedDroidState: string
  generatedKiloState: string
  generatedDevinState: string
  generatedZedState: string
  generatedClaudeProjectMcp: string
  generatedProjectMcpState: string
  geminiSkillsBridge: string
  claudeSkillsBridge: string
  cursorSkillsBridge: string
  windsurfSkillsBridge: string
  kiloSkillsBridge: string
}

/**
 * Keys of ProjectPaths that hold a path.
 *
 * Tables that point at a file (skill bridges, managed configs) name it through this
 * type, so an entry cannot point at `isHome` or at a key that no longer exists.
 */
export type ProjectPathKey = {
  [K in keyof ProjectPaths]: ProjectPaths[K] extends string ? K : never
}[keyof ProjectPaths]

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


/** Resolve the XDG config root (`$XDG_CONFIG_HOME` or `~/.config`). */
export function getXdgConfigDir(homeDir = getHomeDir()): string {
  const xdg = process.env.XDG_CONFIG_HOME
  if (xdg && xdg.trim().length > 0) {
    return path.resolve(xdg.trim())
  }
  return path.join(path.resolve(homeDir), '.config')
}

/** Resolve Goose's global configuration file (`~/.config/goose/config.yaml`). */
export function getGooseConfigPath(homeDir = getHomeDir()): string {
  const override = process.env.AGENTS_GOOSE_CONFIG_PATH
  if (override && override.trim().length > 0) {
    return path.resolve(override.trim())
  }
  return path.join(getXdgConfigDir(homeDir), 'goose', 'config.yaml')
}

/**
 * Pick between a project-local path and a global one, depending on whether the
 * project root is the user's home directory (global mode).
 */
function projectOrGlobal(root: string, homeDir: string, projectRelative: string[], globalPath: string): string {
  return isHomeDirectory(root, homeDir) ? globalPath : path.join(root, ...projectRelative)
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
    generatedSyncState: path.join(generatedDir, 'sync.state.json'),
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
    grokConfig: projectOrGlobal(root, homeDir, ['.grok', 'config.toml'], path.join(homeDir, '.grok', 'config.toml')),
    grokDir: projectOrGlobal(root, homeDir, ['.grok'], path.join(homeDir, '.grok')),
    ampSettings: projectOrGlobal(
      root,
      homeDir,
      ['.amp', 'settings.json'],
      path.join(getXdgConfigDir(homeDir), 'amp', 'settings.json'),
    ),
    ampDir: projectOrGlobal(root, homeDir, ['.amp'], path.join(getXdgConfigDir(homeDir), 'amp')),
    droidMcp: projectOrGlobal(root, homeDir, ['.factory', 'mcp.json'], path.join(homeDir, '.factory', 'mcp.json')),
    droidDir: projectOrGlobal(root, homeDir, ['.factory'], path.join(homeDir, '.factory')),
    kiloConfig: projectOrGlobal(
      root,
      homeDir,
      ['.kilo', 'kilo.jsonc'],
      path.join(getXdgConfigDir(homeDir), 'kilo', 'kilo.jsonc'),
    ),
    kiloDir: projectOrGlobal(root, homeDir, ['.kilo'], path.join(getXdgConfigDir(homeDir), 'kilo')),
    devinMcp: projectOrGlobal(
      root,
      homeDir,
      ['.devin', 'mcp_config.json'],
      path.join(getXdgConfigDir(homeDir), 'devin', 'mcp_config.json'),
    ),
    devinDir: projectOrGlobal(root, homeDir, ['.devin'], path.join(getXdgConfigDir(homeDir), 'devin')),
    zedSettings: projectOrGlobal(
      root,
      homeDir,
      ['.zed', 'settings.json'],
      path.join(getXdgConfigDir(homeDir), 'zed', 'settings.json'),
    ),
    zedDir: projectOrGlobal(root, homeDir, ['.zed'], path.join(getXdgConfigDir(homeDir), 'zed')),
    gooseConfig: getGooseConfigPath(homeDir),
    copilotCliGithubMcp: path.join(root, '.github', 'mcp.json'),
    generatedGrok: path.join(generatedDir, 'grok.config.toml'),
    generatedAmp: path.join(generatedDir, 'amp.settings.json'),
    generatedDroid: path.join(generatedDir, 'droid.mcp.json'),
    generatedKilo: path.join(generatedDir, 'kilo.jsonc'),
    generatedDevin: path.join(generatedDir, 'devin.mcp_config.json'),
    generatedZed: path.join(generatedDir, 'zed.settings.json'),
    // JSON, despite what Goose itself reads: the materializer parses this preview
    // before turning it into YAML, and the extension has to say so.
    generatedGoose: path.join(generatedDir, 'goose.extensions.json'),
    generatedGooseState: path.join(generatedDir, 'goose.state.json'),
    generatedAmpState: path.join(generatedDir, 'amp.state.json'),
    generatedDroidState: path.join(generatedDir, 'droid.state.json'),
    generatedKiloState: path.join(generatedDir, 'kilo.state.json'),
    generatedDevinState: path.join(generatedDir, 'devin.state.json'),
    generatedZedState: path.join(generatedDir, 'zed.state.json'),
    generatedClaudeProjectMcp: path.join(generatedDir, 'claude.project.mcp.json'),
    generatedProjectMcpState: path.join(generatedDir, 'project-mcp.state.json'),
    geminiSkillsBridge: path.join(root, '.gemini', 'skills'),
    claudeSkillsBridge: path.join(root, '.claude', 'skills'),
    cursorSkillsBridge: path.join(root, '.cursor', 'skills'),
    windsurfSkillsBridge: path.join(root, '.windsurf', 'skills'),
    // Kilo reads skills from its own directory. In global mode it looks under the home
    // directory rather than the XDG config dir that holds kilo.jsonc.
    kiloSkillsBridge: projectOrGlobal(root, homeDir, ['.kilo', 'skills'], path.join(homeDir, '.kilo', 'skills'))
  }
}
