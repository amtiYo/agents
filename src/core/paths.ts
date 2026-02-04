import path from 'node:path'

export interface ProjectPaths {
  root: string
  agentsDir: string
  agentsConfig: string
  agentsMd: string
  rootAgentsMd: string
  agentsReadme: string
  mcpDir: string
  mcpRegistry: string
  mcpLocal: string
  mcpLocalExample: string
  generatedDir: string
  generatedCodex: string
  generatedGemini: string
  generatedCopilot: string
  generatedClaude: string
  generatedClaudeState: string
  codexConfig: string
  geminiSettings: string
  vscodeMcp: string
  codexDir: string
  geminiDir: string
  vscodeDir: string
}

export function getProjectPaths(projectRoot: string): ProjectPaths {
  const agentsDir = path.join(projectRoot, '.agents')
  const mcpDir = path.join(agentsDir, 'mcp')
  const generatedDir = path.join(agentsDir, 'generated')
  return {
    root: projectRoot,
    agentsDir,
    agentsConfig: path.join(agentsDir, 'config.json'),
    agentsMd: path.join(agentsDir, 'AGENTS.md'),
    rootAgentsMd: path.join(projectRoot, 'AGENTS.md'),
    agentsReadme: path.join(agentsDir, 'README.md'),
    mcpDir,
    mcpRegistry: path.join(mcpDir, 'registry.json'),
    mcpLocal: path.join(mcpDir, 'local.json'),
    mcpLocalExample: path.join(mcpDir, 'local.example.json'),
    generatedDir,
    generatedCodex: path.join(generatedDir, 'codex.config.toml'),
    generatedGemini: path.join(generatedDir, 'gemini.settings.json'),
    generatedCopilot: path.join(generatedDir, 'copilot.vscode.mcp.json'),
    generatedClaude: path.join(generatedDir, 'claude.mcp.json'),
    generatedClaudeState: path.join(generatedDir, 'claude.state.json'),
    codexConfig: path.join(projectRoot, '.codex', 'config.toml'),
    geminiSettings: path.join(projectRoot, '.gemini', 'settings.json'),
    vscodeMcp: path.join(projectRoot, '.vscode', 'mcp.json'),
    codexDir: path.join(projectRoot, '.codex'),
    geminiDir: path.join(projectRoot, '.gemini'),
    vscodeDir: path.join(projectRoot, '.vscode')
  }
}
