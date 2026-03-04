import path from "node:path";
import { readTextOrEmpty, writeTextAtomic } from "./fs.js";
import {
  validateEnvKey,
  validateEnvValueForShell,
  validateHeaderKey,
  validateServerName,
} from "./mcpValidation.js";
import type { IntegrationName, ResolvedMcpServer } from "../types.js";

export async function writeManagedFile(
  absolutePath: string,
  content: string,
  projectRoot: string,
  check: boolean,
  changed: string[],
): Promise<void> {
  const previous = await readTextOrEmpty(absolutePath);
  if (previous === content) return;

  changed.push(toChangedEntry(projectRoot, absolutePath));

  if (check) return;
  await writeTextAtomic(absolutePath, content);
}

export function toChangedEntry(
  projectRoot: string,
  absolutePath: string,
): string {
  const relative = path.relative(projectRoot, absolutePath);
  if (relative.length === 0) return absolutePath;
  if (relative.startsWith("..") || path.isAbsolute(relative))
    return absolutePath;
  return relative;
}

export function equalSets(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
}

export function compactError(stderr: string): string {
  return stderr.trim().split("\n").at(-1) ?? "unknown error";
}

export function validateResolvedServers(
  resolvedByTarget: Record<IntegrationName, ResolvedMcpServer[]>,
): void {
  for (const [target, servers] of Object.entries(resolvedByTarget)) {
    for (const server of servers) {
      validateServerName(server.name);
      for (const [key, value] of Object.entries(server.env ?? {})) {
        try {
          validateEnvKey(key, "environment variable");
        } catch (error) {
          throw new Error(
            `Invalid environment variable key "${key}" in server "${server.name}" (target: ${target}): ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        validateEnvValueForShell(key, value, "environment variable");
      }
      for (const [key, value] of Object.entries(server.headers ?? {})) {
        try {
          validateHeaderKey(key, "header");
        } catch (error) {
          throw new Error(
            `Invalid header key "${key}" in server "${server.name}" (target: ${target}): ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        validateEnvValueForShell(key, value, "header");
      }
    }
  }
}

export function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}
