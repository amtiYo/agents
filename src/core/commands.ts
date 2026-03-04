import { readdir } from "node:fs/promises";
import { ensureDir, pathExists } from "./fs.js";
import { syncBridge } from "./bridge.js";
import { getProjectPaths } from "./paths.js";
import type { IntegrationName } from "../types.js";

export async function syncCommands(args: {
  projectRoot: string;
  enabledIntegrations: IntegrationName[];
  check: boolean;
  changed: string[];
  warnings: string[];
}): Promise<void> {
  const { projectRoot, enabledIntegrations, check, changed, warnings } = args;
  const paths = getProjectPaths(projectRoot);

  const hasCommands = await hasCommandFiles(paths.agentsCommandsDir);

  await syncBridge({
    enabled: enabledIntegrations.includes("claude") && hasCommands,
    projectRoot,
    parentDir: paths.claudeDir,
    bridgePath: paths.claudeCommandsBridge,
    sourcePath: paths.agentsCommandsDir,
    label: ".claude/commands",
    check,
    changed,
    warnings,
  });
}

async function hasCommandFiles(commandsDir: string): Promise<boolean> {
  if (!(await pathExists(commandsDir))) return false;
  const entries = await readdir(commandsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(".md")) {
      return true;
    }
  }
  return false;
}
