import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import type { Project } from "@ai-film-studio/contracts";

export type ProjectManifestV1 = {
  projectVersion: 1;
  exportedAt: string;
  project: Project;
  characters: unknown[];
  locations: unknown[];
  scenes: unknown[];
  shots: unknown[];
  assets: unknown[];
};

export class ProjectManifestStore {
  constructor(private readonly projectsRoot: string) {}

  async write(project: Project): Promise<string> {
    const directory = this.projectDirectory(project.id);
    await mkdir(directory, { recursive: true });
    const destination = path.join(directory, "project.json");
    const temporary = path.join(directory, `.project.${process.pid}.tmp`);
    const manifest: ProjectManifestV1 = {
      projectVersion: 1,
      exportedAt: new Date().toISOString(),
      project,
      characters: [],
      locations: [],
      scenes: [],
      shots: [],
      assets: [],
    };
    await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporary, destination);
    return destination;
  }

  projectDirectory(projectId: string): string {
    if (!/^[0-9a-f-]{36}$/i.test(projectId)) {
      throw new Error("Invalid project identifier.");
    }
    const directory = path.resolve(this.projectsRoot, projectId);
    const relative = path.relative(path.resolve(this.projectsRoot), directory);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("Project path escapes the configured storage root.");
    }
    return directory;
  }
}
