import type { FastifyInstance } from "fastify";
import { z } from "zod";

const messageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string().min(1).max(16_000),
});

const chatRequestSchema = z.object({
  model: z.string().trim().min(1).max(200).optional(),
  messages: z.array(messageSchema).min(1).max(64),
  temperature: z.number().min(0).max(2).optional(),
});

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const REQUEST_TIMEOUT_MS = 300_000;
const STATUS_TIMEOUT_MS = 3_000;

function resolveOllamaBaseUrl(): string {
  const baseUrl = new URL(
    process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434",
  );
  if (
    baseUrl.protocol !== "http:" ||
    baseUrl.username ||
    baseUrl.password ||
    !LOOPBACK_HOSTS.has(baseUrl.hostname)
  ) {
    throw new Error("OLLAMA_BASE_URL must use HTTP on a loopback host.");
  }
  return baseUrl.toString().replace(/\/$/, "");
}

function resolveDefaultModel(): string {
  return (
    process.env.OLLAMA_CHAT_MODEL?.trim() ||
    process.env.OLLAMA_STORY_MODEL?.trim() ||
    "llama3.2"
  );
}

type OllamaTagsResponse = {
  models?: Array<{ name?: string; model?: string }>;
};

type OllamaChatResponse = {
  message?: { role?: string; content?: string };
  model?: string;
  done?: boolean;
  prompt_eval_count?: number;
  eval_count?: number;
};

export function registerChatRoutes(app: FastifyInstance): void {
  app.get("/chat/ollama/status", async () => {
    const defaultModel = resolveDefaultModel();
    let baseUrl: string;
    try {
      baseUrl = resolveOllamaBaseUrl();
    } catch (error) {
      return {
        available: false,
        defaultModel,
        models: [] as string[],
        message:
          error instanceof Error ? error.message : "Ollama URL is invalid.",
      };
    }
    try {
      const response = await fetch(`${baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
      });
      if (!response.ok) {
        return {
          available: false,
          defaultModel,
          models: [] as string[],
          message: `Ollama returned HTTP ${response.status}.`,
        };
      }
      const body = (await response.json()) as OllamaTagsResponse;
      const models = Array.isArray(body.models)
        ? body.models
            .map((entry) => entry.name ?? entry.model)
            .filter((name): name is string => typeof name === "string")
        : [];
      return {
        available: true,
        defaultModel,
        models,
        message: "Ollama is reachable on the loopback address.",
      };
    } catch {
      return {
        available: false,
        defaultModel,
        models: [] as string[],
        message: "Ollama is not reachable on the loopback address.",
      };
    }
  });

  app.post(
    "/chat/ollama",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const input = chatRequestSchema.parse(request.body);

      let baseUrl: string;
      try {
        baseUrl = resolveOllamaBaseUrl();
      } catch (error) {
        return reply
          .status(422)
          .type("application/problem+json")
          .send({
            type: "https://ai-film-studio.local/problems/provider-configuration",
            title: "Ollama is not configured",
            status: 422,
            detail:
              error instanceof Error
                ? error.message
                : "Ollama URL is invalid.",
            instance: request.url,
          });
      }

      const model = input.model?.trim() || resolveDefaultModel();

      let response: Response;
      try {
        response = await fetch(`${baseUrl}/api/chat`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model,
            stream: false,
            keep_alive: "5m",
            messages: input.messages,
            ...(input.temperature !== undefined
              ? { options: { temperature: input.temperature } }
              : {}),
          }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (error) {
        return reply
          .status(503)
          .type("application/problem+json")
          .send({
            type: "https://ai-film-studio.local/problems/provider-unavailable",
            title: "Ollama is unavailable",
            status: 503,
            detail:
              error instanceof DOMException && error.name === "TimeoutError"
                ? "Local chat request timed out."
                : "Ollama could not be reached on the loopback address.",
            instance: request.url,
          });
      }

      if (!response.ok) {
        return reply
          .status(502)
          .type("application/problem+json")
          .send({
            type: "https://ai-film-studio.local/problems/provider-response",
            title: "Ollama returned an error",
            status: 502,
            detail: `Ollama chat returned HTTP ${response.status}.`,
            instance: request.url,
          });
      }

      const body = (await response.json().catch(() => undefined)) as
        | OllamaChatResponse
        | undefined;
      const content = body?.message?.content;
      if (!body || typeof content !== "string" || content.length === 0) {
        return reply
          .status(502)
          .type("application/problem+json")
          .send({
            type: "https://ai-film-studio.local/problems/provider-response",
            title: "Ollama returned an empty message",
            status: 502,
            detail: "The model replied without any text.",
            instance: request.url,
          });
      }

      return {
        message: {
          role: "assistant" as const,
          content,
        },
        model: typeof body.model === "string" ? body.model : model,
        usage: {
          inputTokens:
            typeof body.prompt_eval_count === "number"
              ? body.prompt_eval_count
              : null,
          outputTokens:
            typeof body.eval_count === "number" ? body.eval_count : null,
        },
      };
    },
  );
}
