import { readdir } from "node:fs/promises";
import { pathExists } from "./fs.js";
import { syncBridge } from "./bridge.js";
import { getProjectPaths } from "./paths.js";
import type { IntegrationName } from "../types.js";

export async function syncHooks(args: {
  projectRoot: string;
  enabledIntegrations: IntegrationName[];
  check: boolean;
  changed: string[];
  warnings: string[];
}): Promise<void> {
  const { projectRoot, enabledIntegrations, check, changed, warnings } = args;
  const paths = getProjectPaths(projectRoot);

  const hasHooks = await hasHookFiles(paths.agentsHooksDir);

  await syncBridge({
    enabled: enabledIntegrations.includes("claude") && hasHooks,
    projectRoot,
    parentDir: paths.claudeDir,
    bridgePath: paths.claudeHooksBridge,
    sourcePath: paths.agentsHooksDir,
    label: ".claude/hooks",
    check,
    changed,
    warnings,
  });
}

async function hasHookFiles(hooksDir: string): Promise<boolean> {
  if (!(await pathExists(hooksDir))) return false;
  const entries = await readdir(hooksDir, { withFileTypes: true });
  return entries.length > 0;
}
