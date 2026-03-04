import { ensureDir } from "./fs.js";
import { loadAgentsConfig, saveAgentsConfig } from "./config.js";
import { loadResolvedRegistry } from "./mcp.js";
import { getProjectPaths } from "./paths.js";
import { buildCodexConfig } from "../integrations/codex.js";
import { buildGeminiPayload } from "../integrations/gemini.js";
import { buildVscodeMcpPayload } from "../integrations/copilotVscode.js";
import { buildCursorPayload } from "../integrations/cursor.js";
import { buildAntigravityPayload } from "../integrations/antigravity.js";
import { buildWindsurfPayload } from "../integrations/windsurf.js";
import { buildOpencodePayload } from "../integrations/opencode.js";
import { renderVscodeMcp } from "./renderers.js";
import { ensureProjectGitignore } from "./gitignore.js";
import { syncSkills } from "./skills.js";
import { syncCommands } from "./commands.js";
import { syncHooks } from "./hooks.js";
import { syncVscodeSettings } from "./vscodeSettings.js";
import { acquireSyncLock } from "./syncLock.js";
import {
  writeManagedFile,
  validateResolvedServers,
  uniqueSorted,
} from "./syncHelpers.js";
import {
  materializeCodex,
  materializeGemini,
  materializeCopilot,
  materializeCursor,
  materializeAntigravityGlobal,
  materializeWindsurfGlobal,
  materializeOpencode,
} from "./syncMaterialize.js";
import { syncClaude, syncCursor } from "./syncIntegrations.js";
import type {
  IntegrationName,
  ResolvedMcpServer,
  SyncOptions,
  SyncResult,
} from "../types.js";

export async function performSync(options: SyncOptions): Promise<SyncResult> {
  const { projectRoot, check, verbose } = options;
  const paths = getProjectPaths(projectRoot);
  const releaseLock = await acquireSyncLock(paths.generatedSyncLock);
  try {
    const config = await loadAgentsConfig(projectRoot);

    const resolved = await loadResolvedRegistry(projectRoot);
    const warnings = [...resolved.warnings];
    if (resolved.missingRequiredEnv.length > 0) {
      warnings.push(
        `Skipped servers because required env vars are missing: ${resolved.missingRequiredEnv.join("; ")}`,
      );
    }
    validateResolvedServers(resolved.serversByTarget);

    const changed: string[] = [];

    if (!check) {
      const gitignoreChanged = await ensureProjectGitignore(
        projectRoot,
        config.syncMode,
      );
      if (gitignoreChanged) {
        changed.push(".gitignore");
      }
    }

    await ensureDir(paths.generatedDir);

    await syncGeneratedFiles({
      projectRoot,
      check,
      changed,
      warnings,
      resolvedByTarget: resolved.serversByTarget,
    });

    const enabled = new Set(config.integrations.enabled);

    if (enabled.has("codex")) {
      await materializeCodex(
        paths.generatedCodex,
        paths.codexConfig,
        check,
        changed,
      );
    }
    if (enabled.has("gemini")) {
      await materializeGemini(
        paths.generatedGemini,
        paths.geminiSettings,
        check,
        changed,
      );
    }
    if (enabled.has("copilot_vscode")) {
      await materializeCopilot(
        paths.generatedCopilot,
        paths.vscodeMcp,
        check,
        changed,
      );
    }
    if (enabled.has("cursor")) {
      await materializeCursor(
        paths.generatedCursor,
        paths.cursorMcp,
        check,
        changed,
      );
    }
    if (enabled.has("antigravity")) {
      await materializeAntigravityGlobal({
        generatedPath: paths.generatedAntigravity,
        legacyProjectPath: paths.antigravityProjectMcp,
        projectRoot,
        check,
        changed,
        warnings,
      });
    }
    if (enabled.has("windsurf")) {
      await materializeWindsurfGlobal({
        generatedPath: paths.generatedWindsurf,
        projectRoot,
        check,
        changed,
      });
    }
    if (enabled.has("opencode")) {
      await materializeOpencode({
        generatedPath: paths.generatedOpencode,
        targetPath: paths.opencodeConfig,
        projectRoot,
        check,
        changed,
        warnings,
      });
    }

    await syncClaude({
      enabled: enabled.has("claude"),
      check,
      projectRoot,
      servers: resolved.serversByTarget.claude,
      statePath: paths.generatedClaudeState,
      changed,
      warnings,
    });

    await syncCursor({
      enabled: enabled.has("cursor"),
      autoApprove: config.integrations.options.cursorAutoApprove,
      check,
      projectRoot,
      servers: resolved.serversByTarget.cursor,
      statePath: paths.generatedCursorState,
      changed,
      warnings,
    });

    await syncSkills({
      projectRoot,
      enabledIntegrations: config.integrations.enabled,
      check,
      changed,
      warnings,
    });

    await syncCommands({
      projectRoot,
      enabledIntegrations: config.integrations.enabled,
      check,
      changed,
      warnings,
    });

    await syncHooks({
      projectRoot,
      enabledIntegrations: config.integrations.enabled,
      check,
      changed,
      warnings,
    });

    await syncVscodeSettings({
      settingsPath: paths.vscodeSettings,
      statePath: paths.generatedVscodeSettingsState,
      hiddenPaths: config.workspace.vscode.hiddenPaths,
      hideGenerated: config.workspace.vscode.hideGenerated,
      check,
      changed,
      warnings,
      projectRoot,
    });

    if (!check) {
      config.lastSync = new Date().toISOString();
      await saveAgentsConfig(projectRoot, config);
    }

    if (verbose && changed.length > 0) {
      for (const entry of changed) {
        process.stdout.write(`updated: ${entry}\n`);
      }
    }

    return {
      changed: uniqueSorted(changed),
      warnings: uniqueSorted(warnings),
    };
  } finally {
    await releaseLock();
  }
}

async function syncGeneratedFiles(args: {
  projectRoot: string;
  check: boolean;
  changed: string[];
  warnings: string[];
  resolvedByTarget: Record<IntegrationName, ResolvedMcpServer[]>;
}): Promise<void> {
  const { projectRoot, check, changed, warnings, resolvedByTarget } = args;
  const paths = getProjectPaths(projectRoot);

  const codex = buildCodexConfig(resolvedByTarget.codex);
  warnings.push(...codex.warnings);
  await writeManagedFile(
    paths.generatedCodex,
    codex.content,
    projectRoot,
    check,
    changed,
  );

  const gemini = buildGeminiPayload(resolvedByTarget.gemini);
  warnings.push(...gemini.warnings);
  await writeManagedFile(
    paths.generatedGemini,
    `${JSON.stringify(gemini.payload, null, 2)}\n`,
    projectRoot,
    check,
    changed,
  );

  const copilot = buildVscodeMcpPayload(resolvedByTarget.copilot_vscode);
  warnings.push(...copilot.warnings);
  await writeManagedFile(
    paths.generatedCopilot,
    `${JSON.stringify(copilot.payload, null, 2)}\n`,
    projectRoot,
    check,
    changed,
  );

  const cursor = buildCursorPayload(resolvedByTarget.cursor);
  warnings.push(...cursor.warnings);
  await writeManagedFile(
    paths.generatedCursor,
    `${JSON.stringify(cursor.payload, null, 2)}\n`,
    projectRoot,
    check,
    changed,
  );

  const antigravity = buildAntigravityPayload(resolvedByTarget.antigravity);
  warnings.push(...antigravity.warnings);
  await writeManagedFile(
    paths.generatedAntigravity,
    `${JSON.stringify(antigravity.payload, null, 2)}\n`,
    projectRoot,
    check,
    changed,
  );

  const windsurf = buildWindsurfPayload(resolvedByTarget.windsurf);
  warnings.push(...windsurf.warnings);
  await writeManagedFile(
    paths.generatedWindsurf,
    `${JSON.stringify(windsurf.payload, null, 2)}\n`,
    projectRoot,
    check,
    changed,
  );

  const opencode = buildOpencodePayload(resolvedByTarget.opencode);
  warnings.push(...opencode.warnings);
  await writeManagedFile(
    paths.generatedOpencode,
    `${JSON.stringify(opencode.payload, null, 2)}\n`,
    projectRoot,
    check,
    changed,
  );

  const claude = renderVscodeMcp(resolvedByTarget.claude);
  warnings.push(...claude.warnings);
  await writeManagedFile(
    paths.generatedClaude,
    `${JSON.stringify({ mcpServers: claude.servers }, null, 2)}\n`,
    projectRoot,
    check,
    changed,
  );
}
