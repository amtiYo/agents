import path from "node:path";
import { pathExists, readJson, readTextOrEmpty } from "./fs.js";
import {
  getAntigravityGlobalMcpPath,
  normalizeAntigravityMcpPayload,
  readAntigravityMcp,
} from "./antigravity.js";
import {
  getWindsurfGlobalMcpPath,
  normalizeWindsurfMcpPayload,
} from "./windsurf.js";
import { normalizeOpencodeConfig } from "./opencode.js";
import { writeManagedFile } from "./syncHelpers.js";

export async function materializeCodex(
  generatedPath: string,
  targetPath: string,
  check: boolean,
  changed: string[],
): Promise<void> {
  const content = await readTextOrEmpty(generatedPath);
  await writeManagedFile(
    targetPath,
    content,
    path.dirname(path.dirname(targetPath)),
    check,
    changed,
  );
}

export async function materializeGemini(
  generatedPath: string,
  targetPath: string,
  check: boolean,
  changed: string[],
): Promise<void> {
  const rawGenerated = await readTextOrEmpty(generatedPath);
  let generated: Record<string, unknown> = {};
  if (rawGenerated.trim()) {
    try {
      generated = JSON.parse(rawGenerated) as Record<string, unknown>;
    } catch (error) {
      throw new Error(
        `Failed to parse generated Gemini config: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  let existing: Record<string, unknown> = {};
  if (await pathExists(targetPath)) {
    try {
      existing = await readJson<Record<string, unknown>>(targetPath);
    } catch (error) {
      console.warn(
        `Warning: Failed to read existing Gemini config at ${targetPath}, starting fresh. Error: ${error instanceof Error ? error.message : String(error)}`,
      );
      existing = {};
    }
  }

  const merged: Record<string, unknown> = {
    ...existing,
    context: {
      ...(typeof existing.context === "object" && existing.context !== null
        ? (existing.context as Record<string, unknown>)
        : {}),
      fileName: "AGENTS.md",
    },
    contextFileName: generated.contextFileName,
    mcpServers: generated.mcpServers,
  };

  await writeManagedFile(
    targetPath,
    `${JSON.stringify(merged, null, 2)}\n`,
    path.dirname(path.dirname(targetPath)),
    check,
    changed,
  );
}

export async function materializeCopilot(
  generatedPath: string,
  targetPath: string,
  check: boolean,
  changed: string[],
): Promise<void> {
  const content = await readTextOrEmpty(generatedPath);
  await writeManagedFile(
    targetPath,
    content,
    path.dirname(path.dirname(targetPath)),
    check,
    changed,
  );
}

export async function materializeCursor(
  generatedPath: string,
  targetPath: string,
  check: boolean,
  changed: string[],
): Promise<void> {
  const content = await readTextOrEmpty(generatedPath);
  await writeManagedFile(
    targetPath,
    content,
    path.dirname(path.dirname(targetPath)),
    check,
    changed,
  );
}

export async function materializeAntigravityGlobal(args: {
  generatedPath: string;
  legacyProjectPath: string;
  projectRoot: string;
  check: boolean;
  changed: string[];
  warnings: string[];
}): Promise<void> {
  const {
    generatedPath,
    legacyProjectPath,
    projectRoot,
    check,
    changed,
    warnings,
  } = args;
  const content = await readTextOrEmpty(generatedPath);
  const globalPath = getAntigravityGlobalMcpPath();

  let normalized: Record<string, unknown> = {};
  if (content.trim().length > 0) {
    try {
      normalized = normalizeAntigravityMcpPayload(
        JSON.parse(content) as Record<string, unknown>,
      );
    } catch (error) {
      throw new Error(
        `Failed to parse generated Antigravity config: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const legacyExists = await pathExists(legacyProjectPath);
  const globalExists = await pathExists(globalPath);
  if (legacyExists && !globalExists) {
    warnings.push(
      `Found legacy .antigravity/mcp.json. Antigravity now uses global MCP at ${globalPath}.`,
    );
  }

  if (legacyExists && globalExists) {
    try {
      const [legacy, global] = await Promise.all([
        readAntigravityMcp(legacyProjectPath),
        readAntigravityMcp(globalPath),
      ]);
      if (legacy && global) {
        const normalizedLegacy = JSON.stringify(
          normalizeAntigravityMcpPayload(legacy),
        );
        const normalizedGlobal = JSON.stringify(
          normalizeAntigravityMcpPayload(global),
        );
        if (normalizedLegacy !== normalizedGlobal) {
          warnings.push(
            `Legacy .antigravity/mcp.json differs from global Antigravity MCP (${globalPath}); local file is ignored.`,
          );
        }
      }
    } catch (error) {
      warnings.push(
        `Could not compare legacy .antigravity/mcp.json with global Antigravity MCP: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  await writeManagedFile(
    globalPath,
    `${JSON.stringify(normalized, null, 2)}\n`,
    projectRoot,
    check,
    changed,
  );
}

export async function materializeWindsurfGlobal(args: {
  generatedPath: string;
  projectRoot: string;
  check: boolean;
  changed: string[];
}): Promise<void> {
  const { generatedPath, projectRoot, check, changed } = args;
  const content = await readTextOrEmpty(generatedPath);
  const globalPath = getWindsurfGlobalMcpPath();

  let normalized: Record<string, unknown> = {};
  if (content.trim().length > 0) {
    try {
      normalized = normalizeWindsurfMcpPayload(
        JSON.parse(content) as Record<string, unknown>,
      );
    } catch (error) {
      throw new Error(
        `Failed to parse generated Windsurf config: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  await writeManagedFile(
    globalPath,
    `${JSON.stringify(normalized, null, 2)}\n`,
    projectRoot,
    check,
    changed,
  );
}

export async function materializeOpencode(args: {
  generatedPath: string;
  targetPath: string;
  projectRoot: string;
  check: boolean;
  changed: string[];
  warnings: string[];
}): Promise<void> {
  const { generatedPath, targetPath, projectRoot, check, changed, warnings } =
    args;
  const rawGenerated = await readTextOrEmpty(generatedPath);
  let generated: Record<string, unknown> = {};
  if (rawGenerated.trim()) {
    try {
      generated = JSON.parse(rawGenerated) as Record<string, unknown>;
    } catch (error) {
      throw new Error(
        `Failed to parse generated OpenCode config: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  let existing: Record<string, unknown> = {};
  if (await pathExists(targetPath)) {
    try {
      existing = await readJson<Record<string, unknown>>(targetPath);
    } catch (error) {
      warnings.push(
        `Failed to read existing OpenCode config at ${targetPath}; starting fresh. ${error instanceof Error ? error.message : String(error)}`,
      );
      existing = {};
    }
  }

  const generatedMcp =
    typeof generated.mcp === "object" &&
    generated.mcp !== null &&
    !Array.isArray(generated.mcp)
      ? (generated.mcp as Record<string, unknown>)
      : {};

  const merged = normalizeOpencodeConfig({
    ...existing,
    mcp: generatedMcp,
  });

  await writeManagedFile(
    targetPath,
    `${JSON.stringify(merged, null, 2)}\n`,
    projectRoot,
    check,
    changed,
  );
}
