import { mkdir } from "node:fs/promises";
import path from "node:path";

import { findWorkspaceRoot } from "@ai-studio/database";

export type StorageConfig = {
  workspaceRoot: string;
  databasePath: string;
  projectsPath: string;
  backupsPath: string;
  cachePath: string;
  secretsPath: string;
};

export function resolveStorageConfig(): StorageConfig {
  const workspaceRoot = findWorkspaceRoot();
  const resolveFromRoot = (value: string): string =>
    path.resolve(workspaceRoot, value);
  const databasePath = resolveFromRoot(
    process.env.DATABASE_PATH ?? "data/ai-studio.sqlite",
  );
  const defaultSecretsPath =
    process.env.NODE_ENV === "test"
      ? path.join(path.dirname(databasePath), "secrets")
      : "data/secrets";
  return {
    workspaceRoot,
    databasePath,
    projectsPath: resolveFromRoot(process.env.PROJECTS_PATH ?? "data/projects"),
    backupsPath: resolveFromRoot(process.env.BACKUPS_PATH ?? "data/backups"),
    cachePath: resolveFromRoot(process.env.CACHE_PATH ?? "cache"),
    secretsPath: resolveFromRoot(
      process.env.SECRETS_PATH ?? defaultSecretsPath,
    ),
  };
}

export async function ensureStorageDirectories(
  config: StorageConfig,
): Promise<void> {
  await Promise.all([
    mkdir(path.dirname(config.databasePath), { recursive: true }),
    mkdir(config.projectsPath, { recursive: true }),
    mkdir(config.backupsPath, { recursive: true }),
    mkdir(config.cachePath, { recursive: true }),
    mkdir(config.secretsPath, { recursive: true, mode: 0o700 }),
  ]);
}
