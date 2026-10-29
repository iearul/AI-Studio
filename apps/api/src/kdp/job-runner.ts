import type { KdpJob, KdpJobKind } from "@ai-studio/contracts";
import type { KdpJobRepository } from "@ai-studio/database";
import { TextProviderAbortedError } from "@ai-studio/providers";

import { KdpBudgetExceededError } from "./ai-router.js";

export class JobCancelledError extends Error {
  constructor() {
    super("The job was cancelled.");
    this.name = "JobCancelledError";
  }
}

/** Context handed to a job handler. */
export class JobContext {
  constructor(
    readonly job: KdpJob,
    readonly ownerId: string,
    readonly signal: AbortSignal,
    private readonly jobs: KdpJobRepository,
  ) {}

  throwIfCancelled(): void {
    if (this.signal.aborted || this.jobs.isCancelRequested(this.job.id)) {
      throw new JobCancelledError();
    }
  }

  /**
   * Runs a checkpointed step. A step that already succeeded (for example
   * before a restart) returns its saved output without calling `compute`.
   * `commit` performs the step's database writes in the same transaction as
   * the checkpoint, so writes are never duplicated or lost.
   */
  async step<T>(
    key: string,
    compute: () => Promise<T>,
    commit?: (output: T) => void,
  ): Promise<T> {
    const existing = this.jobs.getStep<T>(this.job.id, key);
    if (existing && existing.status !== "failed") return existing.output as T;
    this.throwIfCancelled();
    const output = await compute();
    this.throwIfCancelled();
    this.jobs.transaction(() => {
      commit?.(output);
      this.jobs.recordStep(this.job.id, key, "succeeded", output, 1);
    });
    return output;
  }

  /** Marks a step as deliberately skipped (e.g. a chapter locked meanwhile). */
  skip(key: string, reason: string): void {
    this.jobs.recordStep(this.job.id, key, "skipped", { reason }, 0);
  }

  hasCompleted(key: string): boolean {
    const step = this.jobs.getStep(this.job.id, key);
    return step !== undefined && step.status !== "failed";
  }

  progress(stepsDone: number, stepsTotal: number, label: string): void {
    this.jobs.progress(this.job.id, {
      stepsDone,
      stepsTotal,
      progress: stepsTotal === 0 ? 0 : stepsDone / stepsTotal,
      label,
    });
  }
}

export type JobHandler = (
  context: JobContext,
) => Promise<Record<string, unknown>>;

export type JobRunnerOptions = {
  leaseMs?: number;
  heartbeatMs?: number;
  pollMs?: number;
  maxConcurrentJobs?: number;
  onError?: (error: unknown, job: KdpJob) => void;
};

/**
 * Durable worker for book jobs. Jobs live in SQLite; this process claims them
 * with a lease, so a crashed or restarted API resumes them from their last
 * checkpoint instead of starting again.
 */
export class KdpJobRunner {
  private readonly running = new Map<
    string,
    { controller: AbortController; promise: Promise<void> }
  >();
  private interval: NodeJS.Timeout | undefined;
  private ticking = false;
  private readonly leaseMs: number;
  private readonly heartbeatMs: number;
  private readonly pollMs: number;
  private readonly maxConcurrentJobs: number;

  constructor(
    private readonly jobs: KdpJobRepository,
    private readonly handlers: Record<KdpJobKind, JobHandler>,
    private readonly options: JobRunnerOptions = {},
  ) {
    this.leaseMs = options.leaseMs ?? 120_000;
    this.heartbeatMs = options.heartbeatMs ?? 10_000;
    this.pollMs = options.pollMs ?? 2_000;
    this.maxConcurrentJobs = options.maxConcurrentJobs ?? 2;
  }

  get isRunning(): boolean {
    return this.interval !== undefined;
  }

  start(): void {
    if (this.interval) return;
    // Jobs marked running belong to a process that no longer exists.
    this.jobs.releaseLeases();
    this.interval = setInterval(() => this.kick(), this.pollMs);
    this.interval.unref();
    this.kick();
  }

  async stop(): Promise<void> {
    if (this.interval) clearInterval(this.interval);
    this.interval = undefined;
    // Leave jobs as running with their lease; the next start resumes them.
    for (const { controller } of this.running.values()) controller.abort();
    await Promise.allSettled(
      [...this.running.values()].map((entry) => entry.promise),
    );
  }

  kick(): void {
    if (this.ticking) return;
    this.ticking = true;
    try {
      while (this.running.size < this.maxConcurrentJobs) {
        const job = this.jobs.claimNext(
          this.leaseMs,
          new Set(this.running.keys()),
        );
        if (!job) break;
        const controller = new AbortController();
        const promise = this.execute(job, controller).finally(() => {
          this.running.delete(job.id);
          if (this.interval) setImmediate(() => this.interval && this.kick());
        });
        this.running.set(job.id, { controller, promise });
      }
    } finally {
      this.ticking = false;
    }
  }

  /** Requests cancellation; the running step is aborted promptly. */
  cancel(jobId: string): KdpJob {
    const job = this.jobs.requestCancel(jobId);
    this.running.get(jobId)?.controller.abort();
    return job;
  }

  /** Runs queued jobs to completion; used by tests and one-off scripts. */
  async drain(): Promise<void> {
    for (;;) {
      this.kick();
      if (this.running.size === 0) return;
      await Promise.allSettled(
        [...this.running.values()].map((entry) => entry.promise),
      );
    }
  }

  private async execute(
    job: KdpJob,
    controller: AbortController,
  ): Promise<void> {
    const ownerId = this.jobs.jobOwner(job.id) ?? "";
    const heartbeat = setInterval(() => {
      this.jobs.heartbeat(job.id, this.leaseMs);
      if (this.jobs.isCancelRequested(job.id)) controller.abort();
    }, this.heartbeatMs);
    heartbeat.unref();
    const context = new JobContext(job, ownerId, controller.signal, this.jobs);
    try {
      const handler = this.handlers[job.kind];
      const result = await handler(context);
      this.jobs.finish(job.id, "succeeded", { result });
    } catch (error) {
      const stopping =
        controller.signal.aborted && !this.jobs.isCancelRequested(job.id);
      if (stopping) {
        // Server shutdown: keep the job resumable on the next start.
        return;
      }
      if (
        error instanceof JobCancelledError ||
        error instanceof TextProviderAbortedError
      ) {
        this.jobs.finish(job.id, "cancelled", {
          errorMessage:
            "Cancelled. Completed steps are kept; resume to continue.",
        });
      } else if (error instanceof KdpBudgetExceededError) {
        this.jobs.finish(job.id, "budget_stopped", {
          errorMessage: error.message,
        });
      } else {
        this.options.onError?.(error, job);
        this.jobs.finish(job.id, "failed", {
          errorMessage:
            error instanceof Error ? error.message : "The job failed.",
        });
      }
    } finally {
      clearInterval(heartbeat);
    }
  }
}
