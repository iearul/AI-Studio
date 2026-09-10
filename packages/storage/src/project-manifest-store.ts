import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  Project,
  Scene,
  Script,
  Shot,
  Story,
} from "@ai-film-studio/contracts";

export type ProjectManifestContent = {
  story?: Story | null;
  script?: Script | null;
  scenes?: Scene[];
  shots?: Shot[];
  characters?: unknown[];
  locations?: unknown[];
  assets?: unknown[];
};

export type ProjectManifestV1 = {
  projectVersion: 1;
  exportedAt: string;
  project: Project;
  story: Story | null;
  script: Script | null;
  characters: unknown[];
  locations: unknown[];
  scenes: Scene[];
  shots: Shot[];
  assets: unknown[];
};

export class ProjectManifestStore {
  constructor(private readonly projectsRoot: string) {}

  async write(
    project: Project,
    content: ProjectManifestContent = {},
  ): Promise<string> {
    const directory = this.projectDirectory(project.id);
    await mkdir(directory, { recursive: true });
    const destination = path.join(directory, "project.json");
    const temporary = path.join(directory, `.project.${process.pid}.tmp`);
    const manifest: ProjectManifestV1 = {
      projectVersion: 1,
      exportedAt: new Date().toISOString(),
      project,
      story: content.story ?? null,
      script: content.script ?? null,
      characters: content.characters ?? [],
      locations: content.locations ?? [],
      scenes: content.scenes ?? [],
      shots: content.shots ?? [],
      assets: content.assets ?? [],
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
