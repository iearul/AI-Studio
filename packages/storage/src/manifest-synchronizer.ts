import type { ManifestOutboxRepository } from "@ai-film-studio/database";

import type { ProjectManifestStore } from "./project-manifest-store.js";

export class ManifestSynchronizer {
  constructor(
    private readonly outbox: ManifestOutboxRepository,
    private readonly manifests: ProjectManifestStore,
  ) {}

  async drain(limit = 100): Promise<{ completed: number; failed: number }> {
    let completed = 0;
    let failed = 0;
    for (const item of this.outbox.list(limit)) {
      try {
        await this.manifests.write(item.project);
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
