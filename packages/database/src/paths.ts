import { existsSync } from "node:fs";
import path from "node:path";

export function findWorkspaceRoot(start = process.cwd()): string {
  let current = path.resolve(start);
  while (true) {
    if (existsSync(path.join(current, "pnpm-workspace.yaml"))) return current;
    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error("Unable to locate the AI Film Studio workspace root.");
    }
    current = parent;
  }
}

export function resolveDatabasePath(): string {
  const workspaceRoot = findWorkspaceRoot();
  return path.resolve(
    workspaceRoot,
    process.env.DATABASE_PATH ?? "data/film-studio.sqlite",
  );
}
