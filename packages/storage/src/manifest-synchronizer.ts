import type { ManifestOutboxRepository } from "@ai-film-studio/database";

import type {
  ProjectManifestContent,
  ProjectManifestStore,
} from "./project-manifest-store.js";

export class ManifestSynchronizer {
  constructor(
    private readonly outbox: ManifestOutboxRepository,
    private readonly manifests: ProjectManifestStore,
    private readonly loadContent: (
      projectId: string,
    ) => ProjectManifestContent | Promise<ProjectManifestContent> = () => ({}),
  ) {}

  async drain(limit = 100): Promise<{ completed: number; failed: number }> {
    let completed = 0;
    let failed = 0;
    for (const item of this.outbox.list(limit)) {
      try {
        const content = await this.loadContent(item.projectId);
        await this.manifests.write(item.project, content);
        this.outbox.complete(item.projectId);
        completed += 1;
      } catch (error) {
        this.outbox.fail(
          item.projectId,
          error instanceof Error
            ? error.message
            : "Unknown manifest write error",
        );
        failed += 1;
      }
    }
    return { completed, failed };
  }
}
