import type {
  Book,
  KdpSettings,
  KdpTask,
  KdpTaskRoute,
  KdpTextProviderId,
} from "@ai-film-studio/contracts";
import {
  computeCostMicros,
  estimateTokens,
  type PromptSpec,
} from "@ai-film-studio/book-engine";
import type { KdpJobRepository } from "@ai-film-studio/database";
import {
  TextProviderAbortedError,
  TextProviderConfigurationError,
  TextProviderResponseError,
  TextProviderUnavailableError,
  type GeneratedProse,
  type TextProvider,
  type TextUsage,
} from "@ai-film-studio/providers";
import { z, type ZodType } from "zod";

export class KdpBudgetExceededError extends Error {
  constructor(
    readonly spentMicros: number,
    readonly budgetMicros: number,
    readonly estimateMicros: number,
  ) {
    super(
      `This step would cost about $${(estimateMicros / 1e6).toFixed(2)}, which exceeds the book's budget ($${(spentMicros / 1e6).toFixed(2)} of $${(budgetMicros / 1e6).toFixed(2)} spent). Raise the budget in the book settings and resume.`,
    );
    this.name = "KdpBudgetExceededError";
  }
}

export type AiCallContext = {
  ownerId: string;
  book: Book;
  settings: KdpSettings;
  jobId: string | null;
  stepKey: string | null;
  signal?: AbortSignal;
};

export type ResolvedRoute = {
  provider: TextProvider;
  providerId: KdpTextProviderId;
  model: string | null;
  effort: KdpTaskRoute["effort"];
};

type Sleep = (ms: number, signal?: AbortSignal) => Promise<void>;

const defaultSleep: Sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new TextProviderAbortedError());
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new TextProviderAbortedError());
      },
      { once: true },
    );
  });

/** A small counting semaphore per provider, shared by every book and job. */
class Semaphore {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  async acquire(limit: number): Promise<() => void> {
    if (this.active >= limit) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    this.active += 1;
    return () => {
      this.active -= 1;
      this.waiting.shift()?.();
    };
  }
}

const thinkingFactor: Record<NonNullable<KdpTaskRoute["effort"]>, number> = {
  low: 1.1,
  medium: 1.3,
  high: 1.6,
  xhigh: 2,
  max: 2.5,
};

/**
 * Every KDP model call goes through here: task routing, budget stop,
 * concurrency, retries with backoff, response validation and cost logging.
 */
export class KdpAiRouter {
  private readonly providers: Map<KdpTextProviderId, TextProvider>;
  private readonly semaphores = new Map<KdpTextProviderId, Semaphore>();

  constructor(
    providers: TextProvider[],
    private readonly jobs: KdpJobRepository,
    private readonly sleep: Sleep = defaultSleep,
  ) {
    this.providers = new Map(
      providers.map((provider) => [provider.id, provider]),
    );
  }

  providerList(): TextProvider[] {
    return [...this.providers.values()];
  }

  resolve(settings: KdpSettings, book: Book, task: KdpTask): ResolvedRoute {
    const route = { ...settings.routing[task], ...book.settings.routing[task] };
    const provider = this.providers.get(route.provider);
    if (!provider) {
      throw new TextProviderConfigurationError(
        `The ${route.provider} provider is not available for ${task}.`,
      );
    }
    return {
      provider,
      providerId: route.provider,
      model: route.model ?? provider.defaultModel ?? null,
      effort: route.effort,
    };
  }

  budgetMicros(settings: KdpSettings, book: Book): number {
    return Math.round(
      (book.settings.budgetUsd ?? settings.defaultBudgetUsd) * 1_000_000,
    );
  }

  estimateMicros(
    settings: KdpSettings,
    route: ResolvedRoute,
    prompt: PromptSpec,
    expectedOutputTokens: number,
  ): number {
    const input = estimateTokens(
      `${prompt.system}\n${prompt.cachedContext ?? ""}\n${prompt.prompt}`,
    );
    const output = Math.round(
      expectedOutputTokens *
        (route.providerId === "anthropic"
          ? thinkingFactor[route.effort ?? "high"]
          : 1.15),
    );
    return computeCostMicros(settings, route.providerId, route.model ?? "", {
      inputTokens: input,
      outputTokens: output,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    }).costMicros;
  }

  private checkBudget(context: AiCallContext, estimate: number): void {
    if (estimate === 0) return;
    const budget = this.budgetMicros(context.settings, context.book);
    const spent = this.jobs.spentMicros(context.book.id);
    if (spent + estimate > budget) {
      throw new KdpBudgetExceededError(spent, budget, estimate);
    }
  }

  async json<T>(
    context: AiCallContext,
    task: KdpTask,
    prompt: PromptSpec,
    schema: ZodType<T>,
    options: {
      schemaName: string;
      expectedOutputTokens: number;
      maxOutputTokens?: number;
    },
  ): Promise<T> {
    const jsonSchema = z.toJSONSchema(schema, {
      target: "draft-7",
      unrepresentable: "throw",
    }) as Record<string, unknown>;
    return this.call(
      context,
      task,
      prompt,
      options.expectedOutputTokens,
      async (route) => {
        const generated = await route.provider.generate({
          system: prompt.system,
          cachedContext: prompt.cachedContext,
          prompt: prompt.prompt,
          schemaName: options.schemaName,
          schema: jsonSchema,
          ...(route.model ? { model: route.model } : {}),
          ...(route.effort ? { effort: route.effort } : {}),
          maxOutputTokens: options.maxOutputTokens,
          signal: context.signal,
        });
        const parsed = schema.safeParse(generated.output);
        return {
          model: generated.model,
          usage: generated.usage,
          result: parsed.success ? parsed.data : undefined,
          error: parsed.success
            ? undefined
            : new TextProviderResponseError(
                `The model's response failed validation: ${parsed.error.issues
                  .slice(0, 3)
                  .map(
                    (issue) =>
                      `${issue.path.join(".") || "response"}: ${issue.message}`,
                  )
                  .join("; ")}`,
              ),
        };
      },
    );
  }

  async prose(
    context: AiCallContext,
    task: KdpTask,
    prompt: PromptSpec,
    options: { expectedOutputTokens: number; maxOutputTokens?: number },
  ): Promise<GeneratedProse> {
    return this.call(
      context,
      task,
      prompt,
      options.expectedOutputTokens,
      async (route) => {
        if (!route.provider.complete) {
          throw new TextProviderConfigurationError(
            `${route.providerId} cannot write long-form prose.`,
          );
        }
        const generated = await route.provider.complete({
          system: prompt.system,
          cachedContext: prompt.cachedContext,
          prompt: prompt.prompt,
          ...(route.model ? { model: route.model } : {}),
          ...(route.effort ? { effort: route.effort } : {}),
          maxOutputTokens: options.maxOutputTokens,
          signal: context.signal,
        });
        return {
          model: generated.model,
          usage: generated.usage,
          result: generated.truncated ? undefined : generated,
          error: generated.truncated
            ? new TextProviderResponseError(
                "The model hit its output limit before finishing.",
              )
            : undefined,
        };
      },
    );
  }

  private async call<T>(
    context: AiCallContext,
    task: KdpTask,
    prompt: PromptSpec,
    expectedOutputTokens: number,
    execute: (route: ResolvedRoute) => Promise<{
      model: string;
      usage: TextUsage;
      result: T | undefined;
      error: Error | undefined;
    }>,
  ): Promise<T> {
    const route = this.resolve(context.settings, context.book, task);
    const maxRetries = context.settings.maxRetries;
    let responseRetries = 0;
    for (let attempt = 0; ; attempt += 1) {
      this.checkBudget(
        context,
        this.estimateMicros(
          context.settings,
          route,
          prompt,
          expectedOutputTokens,
        ),
      );
      const semaphore =
        this.semaphores.get(route.providerId) ?? new Semaphore();
      this.semaphores.set(route.providerId, semaphore);
      const release = await semaphore.acquire(
        context.settings.maxConcurrentRequestsPerProvider,
      );
      const startedAt = Date.now();
      let failure: unknown;
      try {
        const outcome = await execute(route);
        this.record(
          context,
          task,
          route,
          outcome.model,
          outcome.usage,
          Date.now() - startedAt,
          outcome.error,
        );
        if (outcome.result !== undefined) return outcome.result;
        failure = outcome.error;
      } catch (error) {
        failure = error;
        this.record(
          context,
          task,
          route,
          route.model ?? "unknown",
          null,
          Date.now() - startedAt,
          error,
        );
      } finally {
        release();
      }
      if (
        failure instanceof TextProviderAbortedError ||
        context.signal?.aborted
      ) {
        throw new TextProviderAbortedError();
      }
      const retryable =
        (failure instanceof TextProviderUnavailableError &&
          failure.retryable &&
          attempt < maxRetries) ||
        // A malformed or truncated response usually succeeds on a second try.
        (failure instanceof TextProviderResponseError &&
          !/declined/i.test(failure.message) &&
          responseRetries < Math.min(1, maxRetries));
      if (!retryable) throw failure;
      if (failure instanceof TextProviderResponseError) responseRetries += 1;
      const delay =
        failure instanceof TextProviderUnavailableError &&
        failure.retryAfterMs !== null
          ? Math.min(failure.retryAfterMs, 120_000)
          : Math.min(60_000, 2_000 * 2 ** attempt) +
            Math.round(Math.random() * 500);
      await this.sleep(delay, context.signal);
    }
  }

  private record(
    context: AiCallContext,
    task: KdpTask,
    route: ResolvedRoute,
    model: string,
    usage: TextUsage | null,
    durationMs: number,
    error: unknown,
  ): void {
    const tokens = {
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
      cacheReadTokens: usage?.cacheReadTokens ?? 0,
      cacheWriteTokens: usage?.cacheWriteTokens ?? 0,
    };
    const cost = usage
      ? computeCostMicros(context.settings, route.providerId, model, tokens)
      : { costMicros: 0, estimated: false };
    this.jobs.recordRun({
      bookId: context.book.id,
      jobId: context.jobId,
      stepKey: context.stepKey,
      task,
      provider: route.providerId,
      model,
      ...tokens,
      costMicros: cost.costMicros,
      estimated: cost.estimated,
      durationMs,
      status: error
        ? error instanceof TextProviderAbortedError
          ? "cancelled"
          : "failed"
        : "succeeded",
      errorMessage: error instanceof Error ? error.message.slice(0, 500) : null,
    });
  }
}
