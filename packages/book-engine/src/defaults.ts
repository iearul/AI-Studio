import type {
  AuthorProfileInput,
  KdpModelPrice,
  KdpSettings,
  KdpTextProviderId,
} from "@ai-studio/contracts";

// Claude prices from Anthropic's published table (2026-10-06): cache reads
// are listed per model, cache writes cost 1.25× input for the 5-minute TTL.
// OpenAI prices are placeholders the user must confirm in Settings.
export const defaultModelPrices: KdpModelPrice[] = [
  {
    provider: "anthropic",
    model: "claude-opus-5-5",
    inputPerMTok: 4,
    outputPerMTok: 20,
    cacheReadPerMTok: 0.2,
    cacheWritePerMTok: 5,
    verified: true,
    source: "Anthropic pricing table, cached 2026-10-06",
  },
  {
    provider: "anthropic",
    model: "claude-sonnet-5-5",
    inputPerMTok: 2,
    outputPerMTok: 10,
    cacheReadPerMTok: 0.2,
    cacheWritePerMTok: 2.5,
    verified: true,
    source: "Anthropic pricing table, cached 2026-10-06",
  },
  {
    provider: "anthropic",
    model: "claude-haiku-5-5",
    inputPerMTok: 0.1,
    outputPerMTok: 0.5,
    cacheReadPerMTok: 0.01,
    cacheWritePerMTok: 0.125,
    verified: false,
    source: "Input/output from Anthropic's table; cache prices estimated",
  },
  {
    provider: "openai",
    model: "gpt-5.4-mini",
    inputPerMTok: 0.75,
    outputPerMTok: 4.5,
    cacheReadPerMTok: 0.075,
    cacheWritePerMTok: 0.75,
    verified: false,
    source: "Placeholder — confirm on openai.com/api/pricing",
  },
  {
    provider: "ollama",
    model: "*",
    inputPerMTok: 0,
    outputPerMTok: 0,
    cacheReadPerMTok: 0,
    cacheWritePerMTok: 0,
    verified: true,
    source: "Runs locally",
  },
];

export const defaultKdpSettings: KdpSettings = {
  routing: {
    idea: { provider: "anthropic", model: null, effort: "high" },
    architect: { provider: "anthropic", model: null, effort: "high" },
    writer: { provider: "anthropic", model: null, effort: "high" },
    reviewer: { provider: "anthropic", model: null, effort: "high" },
    inspector: { provider: "openai", model: null, effort: null },
    proofreader: { provider: "openai", model: null, effort: null },
    metadata: { provider: "openai", model: null, effort: null },
    cover: { provider: "openai", model: null, effort: null },
  },
  prices: defaultModelPrices,
  unknownModelPrice: { inputPerMTok: 5, outputPerMTok: 25 },
  defaultBudgetUsd: 20,
  maxConcurrentRequestsPerProvider: 2,
  maxRetries: 3,
  defaultCraftProfile: "",
};

export const defaultAuthorProfile: AuthorProfileInput = {
  penName: "V. K. Rabenhorst",
  genres: [
    "Psychological thriller",
    "Mystery",
    "Supernatural horror",
    "Romantic suspense",
  ],
  defaultLanguage: "en",
  defaultStyle:
    "Close, restrained narration with precise detail; tension built through character choices rather than shock.",
  biography: null,
  shortBiography: null,
  website: null,
  links: [],
  dedication: null,
  contentNotice: null,
  aboutAuthor: null,
  callToAction: null,
  nextBookPreview: null,
  copyrightNotice: null,
  coverBranding: null,
  contentPreferences:
    "Clean to sensual but never sexually explicit; violence serves the story.",
  isDefault: true,
  provisional: true,
};

export function findPrice(
  prices: KdpModelPrice[],
  provider: KdpTextProviderId,
  model: string,
): KdpModelPrice | undefined {
  return (
    prices.find(
      (price) => price.provider === provider && price.model === model,
    ) ??
    // Providers return dated snapshots such as gpt-5.4-mini-2026-03-01.
    prices.find(
      (price) =>
        price.provider === provider && model.startsWith(`${price.model}-`),
    ) ??
    prices.find((price) => price.provider === provider && price.model === "*")
  );
}

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

/** Cost in micro-dollars; `estimated` is true when no table price matched. */
export function computeCostMicros(
  settings: Pick<KdpSettings, "prices" | "unknownModelPrice">,
  provider: KdpTextProviderId,
  model: string,
  usage: TokenUsage,
): { costMicros: number; estimated: boolean } {
  const price = findPrice(settings.prices, provider, model);
  const input = price?.inputPerMTok ?? settings.unknownModelPrice.inputPerMTok;
  const output =
    price?.outputPerMTok ?? settings.unknownModelPrice.outputPerMTok;
  const cacheRead = price?.cacheReadPerMTok ?? input;
  const cacheWrite = price?.cacheWritePerMTok ?? input * 1.25;
  const dollars =
    (usage.inputTokens * input +
      usage.outputTokens * output +
      usage.cacheReadTokens * cacheRead +
      usage.cacheWriteTokens * cacheWrite) /
    1_000_000;
  return {
    costMicros: Math.round(dollars * 1_000_000),
    estimated: !price || !price.verified,
  };
}
