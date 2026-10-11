# ADR 0004: Selectable and human-reviewed story AI providers

- Status: Accepted
- Date: 2026-09-11

## Context

Story creation needs three different operating modes: convenient paid automation,
private local generation with no per-token fee, and a manual ChatGPT workflow that
works without API billing. All modes must return the same story/script/scene/shot
shape and must not silently replace filmmaker-approved work.

## Decision

- The Story Room exposes Local Ollama, OpenAI API, Claude API, and Manual ChatGPT
  as explicit choices. The local provider is selected by default when it is ready.
- `packages/providers` owns a provider-neutral text interface. The OpenAI adapter
  uses the Responses API with a strict JSON Schema, `store: false`, and a server-only
  API key. The Claude adapter uses the official Anthropic SDK to stream a Messages
  API request with structured output, adaptive thinking, and server-side refusal
  fallback (`fallbacks: "default"`). The Ollama adapter is restricted to loopback
  HTTP, disables thinking, and uses the same required object shape with grammar
  keywords unsupported by the installed llama.cpp engine removed.
- OpenAI defaults to `gpt-5.4-mini` and Claude to `claude-opus-5-5` at `high`
  effort; any paid request requires a user confirmation that API tokens are billed
  separately. Manual ChatGPT preserves prompt export, validation, and JSON import
  without subscription automation.
- Ollama uses `qwen3.5:9b-q4_K_M` on the M3 Pro with 18 GB unified memory. The MLX
  build was rejected because the installed Ollama runtime returned HTTP 501 for
  structured output, which the story contract requires. The Q4 model runs locally
  with no per-token provider charge and unloads after generation.
- Automatic provider output is validated twice: provider-side constrained generation
  and full server-side Zod domain validation. OpenAI receives the strict complete
  schema; Ollama receives its structural subset because its grammar parser rejects
  constraints such as string patterns and lengths. Claude keeps enums and structure
  but receives numeric, length, pattern, and item-count limits as field descriptions,
  because its structured output rejects those keywords. The result is only a
  preview. Saving or replacing a plan remains a separate explicit action.
- Automatic generation is rate-limited and one project cannot start overlapping
  story requests in a single API process. Provider errors are normalized and never
  reveal credentials or raw upstream payloads.

## Consequences

- Provider selection can change without changing story persistence or downstream
  Visual Bible and storyboard workflows.
- Local generation trades cloud cost for a slower cold start and significant unified
  memory use. OpenAI and Claude are faster but incur independent API billing.
- A failed or low-quality automatic result does not mutate the existing project.
