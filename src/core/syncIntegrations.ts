import path from "node:path";
import { ensureDir, pathExists, readJson, writeJsonAtomic } from "./fs.js";
import { commandExists, runCommand } from "./shell.js";
import { toManagedClaudeName } from "../integrations/claude.js";
import { listCursorMcpStatuses } from "./cursorCli.js";
import { listClaudeManagedServerNames } from "./claudeCli.js";
import {
  validateEnvValueForShell,
  validateServerName,
} from "./mcpValidation.js";
import { compactError, equalSets } from "./syncHelpers.js";
import type { ResolvedMcpServer } from "../types.js";

interface ClaudeState {
  managedNames: string[];
}

interface CursorState {
  managedNames: string[];
}

export async function syncClaude(args: {
  enabled: boolean;
  check: boolean;
  projectRoot: string;
  servers: ResolvedMcpServer[];
  statePath: string;
  changed: string[];
  warnings: string[];
}): Promise<void> {
  const { enabled, check, projectRoot, servers, statePath, changed, warnings } =
    args;
  const command = "claude";

  const state: ClaudeState = (await pathExists(statePath))
    ? await readJson<ClaudeState>(statePath)
    : { managedNames: [] };

  for (const server of servers) {
    validateServerName(server.name);
  }

  const desiredNames = enabled
    ? servers.map((server) => toManagedClaudeName(server.name))
    : [];
  let currentNames = state.managedNames ?? [];
  const hasClaudeCli = commandExists(command);

  if (enabled && hasClaudeCli) {
    const listed = listClaudeManagedServerNames(projectRoot);
    if (listed.ok) {
      currentNames = listed.names;
    } else {
      warnings.push(
        `Failed checking Claude MCP status: ${compactError(listed.stderr)}`,
      );
    }
  }

  if (equalSets(new Set(currentNames), new Set(desiredNames))) {
    return;
  }
  changed.push("claude-local-scope");

  if (check) return;

  if (!hasClaudeCli) {
    warnings.push("Claude CLI not found; skipped Claude MCP sync.");
    return;
  }

  const namesToRemove = currentNames.filter(
    (name) => !desiredNames.includes(name),
  );
  for (const name of namesToRemove) {
    const removed = runCommand(
      command,
      ["mcp", "remove", "-s", "local", name],
      projectRoot,
    );
    if (
      !removed.ok &&
      !removed.stderr.includes("not found") &&
      !removed.stderr.includes("No project-local MCP server found")
    ) {
      warnings.push(
        `Failed removing Claude MCP server ${name}: ${compactError(removed.stderr)}`,
      );
    }
  }

  if (!enabled) {
    await writeJsonAtomic(statePath, { managedNames: [] });
    return;
  }

  const appliedNames: string[] = [];
  for (const server of servers) {
    const name = toManagedClaudeName(server.name);
    const result = addClaudeServer(command, projectRoot, name, server);
    if (!result.ok) {
      warnings.push(
        `Failed adding Claude MCP server ${name}: ${compactError(result.stderr)}`,
      );
      continue;
    }
    appliedNames.push(name);
  }

  await ensureDir(path.dirname(statePath));
  await writeJsonAtomic(statePath, { managedNames: appliedNames });
}

export async function syncCursor(args: {
  enabled: boolean;
  autoApprove: boolean;
  check: boolean;
  projectRoot: string;
  servers: ResolvedMcpServer[];
  statePath: string;
  changed: string[];
  warnings: string[];
}): Promise<void> {
  const {
    enabled,
    autoApprove,
    check,
    projectRoot,
    servers,
    statePath,
    changed,
    warnings,
  } = args;
  const command = "cursor-agent";

  const state: CursorState = (await pathExists(statePath))
    ? await readJson<CursorState>(statePath)
    : { managedNames: [] };

  for (const server of servers) {
    validateServerName(server.name);
  }

  const desiredNames = enabled ? servers.map((server) => server.name) : [];
  const currentNames = state.managedNames ?? [];
  const hasCursorCli = commandExists(command);
  let namesNeedingApproval = new Set<string>();

  if (enabled && autoApprove && hasCursorCli) {
    const listed = listCursorMcpStatuses(projectRoot);
    if (!listed.ok) {
      warnings.push(
        `Failed checking Cursor MCP status: ${compactError(listed.stderr)}`,
      );
    } else {
      const unknownStatuses: string[] = [];
      const errorStatuses: string[] = [];
      namesNeedingApproval = new Set<string>();

      for (const name of desiredNames) {
        const status = listed.statuses[name];
        if (status === undefined) {
          namesNeedingApproval.add(name);
          continue;
        }
        if (status === "needs-approval" || status === "disabled") {
          namesNeedingApproval.add(name);
          continue;
        }
        if (status === "unknown") {
          unknownStatuses.push(name);
          continue;
        }
        if (status === "error") {
          errorStatuses.push(name);
        }
      }

      if (unknownStatuses.length > 0) {
        warnings.push(
          `Cursor MCP status unknown for: ${unknownStatuses.join(", ")}. Skipping auto-approval retries for these servers.`,
        );
      }
      if (errorStatuses.length > 0) {
        warnings.push(
          `Cursor MCP connection errors for: ${errorStatuses.join(", ")}. Skipping auto-approval retries for these servers.`,
        );
      }
    }
  }

  if (
    equalSets(new Set(currentNames), new Set(desiredNames)) &&
    namesNeedingApproval.size === 0
  ) {
    return;
  }
  changed.push("cursor-local-approval");

  if (check) return;

  if (!hasCursorCli) {
    warnings.push("Cursor CLI not found; skipped Cursor MCP approval sync.");
    return;
  }

  const toDisable = currentNames.filter((name) => !desiredNames.includes(name));
  for (const name of toDisable) {
    const result = runCommand(command, ["mcp", "disable", name], projectRoot);
    if (!result.ok && !result.stderr.toLowerCase().includes("not found")) {
      warnings.push(
        `Failed disabling Cursor MCP server ${name}: ${compactError(result.stderr)}`,
      );
    }
  }

  if (!enabled || !autoApprove) {
    await writeJsonAtomic(statePath, { managedNames: desiredNames });
    return;
  }

  const approved: string[] = [];
  for (const name of desiredNames) {
    if (!namesNeedingApproval.has(name)) {
      approved.push(name);
      continue;
    }
    const result = runCommand(command, ["mcp", "enable", name], projectRoot);
    if (!result.ok && !isCursorAlreadyEnabledError(result.stderr)) {
      warnings.push(
        `Failed enabling Cursor MCP server ${name}: ${compactError(result.stderr)}`,
      );
      continue;
    }
    approved.push(name);
  }

  await ensureDir(path.dirname(statePath));
  await writeJsonAtomic(statePath, { managedNames: approved });
}

function addClaudeServer(
  command: string,
  projectRoot: string,
  name: string,
  server: ResolvedMcpServer,
): { ok: boolean; stderr: string } {
  if (server.transport === "stdio") {
    if (!server.command) {
      return { ok: false, stderr: "missing command" };
    }

    const args: string[] = ["mcp", "add", "-s", "local", name];
    for (const [key, value] of Object.entries(server.env ?? {})) {
      validateEnvValueForShell(key, value, "environment variable");
      args.push("-e", `${key}=${value}`);
    }
    args.push("--", server.command, ...(server.args ?? []));
    const result = runCommand(command, args, projectRoot);
    if (!result.ok && isClaudeAlreadyExistsError(result.stderr)) {
      return { ok: true, stderr: result.stderr };
    }
    return { ok: result.ok, stderr: result.stderr };
  }

  if (!server.url) {
    return { ok: false, stderr: "missing url" };
  }

  const args: string[] = [
    "mcp",
    "add",
    "-s",
    "local",
    "-t",
    server.transport,
    name,
    server.url,
  ];
  for (const [key, value] of Object.entries(server.headers ?? {})) {
    validateEnvValueForShell(key, value, "header");
    args.push("-H", `${key}: ${value}`);
  }
  const result = runCommand(command, args, projectRoot);
  if (!result.ok && isClaudeAlreadyExistsError(result.stderr)) {
    return { ok: true, stderr: result.stderr };
  }
  return { ok: result.ok, stderr: result.stderr };
}

function isClaudeAlreadyExistsError(stderr: string): boolean {
  return stderr.toLowerCase().includes("already exists in local config");
}

function isCursorAlreadyEnabledError(stderr: string): boolean {
  const lowered = stderr.toLowerCase();
  return (
    lowered.includes("already enabled") || lowered.includes("already approved")
  );
}
