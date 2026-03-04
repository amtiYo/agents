import path from "node:path";
import { lstat, readdir, readlink, symlink } from "node:fs/promises";
import {
  copyDir,
  ensureDir,
  pathExists,
  removeIfExists,
  writeTextAtomic,
} from "./fs.js";

export async function syncBridge(args: {
  enabled: boolean;
  projectRoot: string;
  parentDir: string;
  bridgePath: string;
  sourcePath: string;
  label: string;
  check: boolean;
  changed: string[];
  warnings: string[];
}): Promise<void> {
  const {
    enabled,
    projectRoot,
    parentDir,
    bridgePath,
    sourcePath,
    label,
    check,
    changed,
    warnings,
  } = args;
  const expectedRelative =
    path.relative(path.dirname(bridgePath), sourcePath) || ".";

  if (!enabled) {
    const removed = await cleanupManagedBridge(
      bridgePath,
      expectedRelative,
      sourcePath,
    );
    if (removed) {
      changed.push(path.relative(projectRoot, bridgePath) || bridgePath);
      if (!check) {
        await removeIfExists(bridgePath);
      }
    }
    return;
  }

  await ensureDir(parentDir);

  const exists = await pathExists(bridgePath);
  if (exists) {
    const linkInfo = await lstat(bridgePath);
    if (linkInfo.isSymbolicLink()) {
      const current = await readlink(bridgePath);
      if (
        current === expectedRelative ||
        path.resolve(path.dirname(bridgePath), current) === sourcePath
      ) {
        return;
      }
      changed.push(path.relative(projectRoot, bridgePath) || bridgePath);
      if (!check) {
        await removeIfExists(bridgePath);
      }
    } else {
      const marker = path.join(bridgePath, ".agents_bridge");
      if (await pathExists(marker)) {
        if (!check) {
          await copyDir(sourcePath, bridgePath);
        }
        return;
      } else {
        warnings.push(
          `Found existing ${label} that is not managed by agents: ${bridgePath}`,
        );
        return;
      }
    }
  }

  changed.push(path.relative(projectRoot, bridgePath) || bridgePath);
  if (check) return;

  try {
    await symlink(expectedRelative, bridgePath);
  } catch (error) {
    await copyDir(sourcePath, bridgePath);
    await writeTextAtomic(
      path.join(bridgePath, ".agents_bridge"),
      "managed-by-agents\n",
    );
    const message = error instanceof Error ? error.message : String(error);
    warnings.push(`${label} bridge fallback to copy mode: ${message}`);
  }
}

export async function cleanupManagedBridge(
  bridgePath: string,
  expectedRelative: string,
  expectedAbsolute: string,
): Promise<boolean> {
  if (!(await pathExists(bridgePath))) {
    return false;
  }

  const info = await lstat(bridgePath);
  if (info.isSymbolicLink()) {
    const current = await readlink(bridgePath);
    return (
      current === expectedRelative ||
      path.resolve(path.dirname(bridgePath), current) === expectedAbsolute
    );
  }

  const marker = path.join(bridgePath, ".agents_bridge");
  return pathExists(marker);
}
