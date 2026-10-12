import {
  audioProviderStatusSchema,
  voiceSchema,
  type AudioProviderStatus,
  type Voice,
} from "@ai-film-studio/contracts";

import {
  AudioProviderConfigurationError,
  AudioProviderResponseError,
  AudioProviderUnavailableError,
  type AudioProvider,
  type DialogueTurn,
  type GeneratedAudio,
} from "./audio-provider.js";
import { usdToMicros } from "./image-provider.js";
import { positiveIntegerEnvironment } from "./text-provider.js";

export type ElevenLabsAudioProviderConfig = {
  apiKey: string | null;
  speechModel: string;
  musicModel: string;
  timeoutMs: number;
};

type JsonObject = Record<string, unknown>;

const baseUrl = "https://api.elevenlabs.io";
const outputFormat = "mp3_44100_128";

// ElevenLabs list API prices (USD), used as estimates.
const speechUsdPer1kCharacters: Record<string, number> = {
  eleven_v4: 0.08,
  eleven_v4_turbo: 0.04,
  eleven_v3: 0.08,
  eleven_multilingual_v2: 0.08,
  eleven_flash_v2_5: 0.04,
};
const soundEffectUsdPerMinute = 0.12;
const soundEffectModel = "eleven_text_to_sound_v2";
const musicUsdPerMinute = 0.15;

export function resolveElevenLabsAudioProviderConfig(): ElevenLabsAudioProviderConfig {
  return {
    apiKey: process.env.ELEVENLABS_API_KEY?.trim() || null,
    speechModel: process.env.ELEVENLABS_SPEECH_MODEL?.trim() || "eleven_v4",
    musicModel: process.env.ELEVENLABS_MUSIC_MODEL?.trim() || "music_v2_5",
    timeoutMs: positiveIntegerEnvironment(
      "ELEVENLABS_TIMEOUT_MS",
      300_000,
      10_000,
      900_000,
    ),
  };
}

export class ElevenLabsAudioProvider implements AudioProvider {
  readonly id = "elevenlabs" as const;

  constructor(
    readonly config: ElevenLabsAudioProviderConfig,
    private readonly request: typeof fetch = fetch,
  ) {}

  status(): AudioProviderStatus {
    return audioProviderStatusSchema.parse({
      id: this.id,
      label: "ElevenLabs",
      configured: Boolean(this.config.apiKey),
      message: this.config.apiKey
        ? "Ready. Audio is billed to your ElevenLabs account."
        : "Add ELEVENLABS_API_KEY to .env.local and restart AI Film Studio.",
      speechModel: this.config.speechModel,
      soundEffectModel,
      musicModel: this.config.musicModel,
      estimatedUsd: {
        speechPer1kCharacters: this.speechRate(),
        soundEffectPerMinute: soundEffectUsdPerMinute,
        musicPerMinute: musicUsdPerMinute,
      },
    });
  }

  async listVoices(): Promise<Voice[]> {
    const voices: Voice[] = [];
    let pageToken: string | null = null;
    // Five pages of 100 cover any personal library plus the default voices.
    for (let page = 0; page < 5; page++) {
      const query = new URLSearchParams({ page_size: "100" });
      if (pageToken) query.set("next_page_token", pageToken);
      const response = await this.send(`/v2/voices?${query.toString()}`, {
        method: "GET",
      });
      const body = asObject(await safeJson(response));
      for (const item of Array.isArray(body?.voices) ? body.voices : []) {
        const voice = asObject(item);
        const parsed = voiceSchema.safeParse({
          voiceId: voice?.voice_id,
          name: voice?.name,
          category: typeof voice?.category === "string" ? voice.category : null,
          description:
            typeof voice?.description === "string" ? voice.description : null,
          labels: Object.fromEntries(
            Object.entries(asObject(voice?.labels) ?? {}).filter(
              (entry): entry is [string, string] =>
                typeof entry[1] === "string",
            ),
          ),
          previewUrl:
            typeof voice?.preview_url === "string" ? voice.preview_url : null,
        });
        if (parsed.success) voices.push(parsed.data);
      }
      pageToken =
        body?.has_more === true && typeof body.next_page_token === "string"
          ? body.next_page_token
          : null;
      if (!pageToken) break;
    }
    return voices;
  }

  async speech(input: {
    voiceId: string;
    text: string;
    languageCode: string | null;
  }): Promise<GeneratedAudio> {
    const data = await this.audio(
      `/v1/text-to-speech/${encodeURIComponent(input.voiceId)}?output_format=${outputFormat}`,
      {
        text: input.text,
        model_id: this.config.speechModel,
        ...(input.languageCode ? { language_code: input.languageCode } : {}),
      },
    );
    return {
      data,
      model: this.config.speechModel,
      costMicros: usdToMicros((input.text.length / 1000) * this.speechRate()),
    };
  }

  async dialogue(input: {
    turns: DialogueTurn[];
    languageCode: string | null;
  }): Promise<GeneratedAudio> {
    const characters = input.turns.reduce(
      (total, turn) => total + turn.text.length,
      0,
    );
    const data = await this.audio(
      `/v1/text-to-dialogue?output_format=${outputFormat}`,
      {
        inputs: input.turns.map((turn) => ({
          text: turn.text,
          voice_id: turn.voiceId,
        })),
        model_id: this.config.speechModel,
        ...(input.languageCode ? { language_code: input.languageCode } : {}),
      },
    );
    return {
      data,
      model: this.config.speechModel,
      costMicros: usdToMicros((characters / 1000) * this.speechRate()),
    };
  }

  async soundEffect(input: {
    prompt: string;
    durationSeconds: number;
  }): Promise<GeneratedAudio> {
    const durationSeconds = Math.min(30, Math.max(0.5, input.durationSeconds));
    const data = await this.audio(
      `/v1/sound-generation?output_format=${outputFormat}`,
      {
        text: input.prompt,
        duration_seconds: durationSeconds,
        prompt_influence: 0.5,
        model_id: soundEffectModel,
      },
    );
    return {
      data,
      model: soundEffectModel,
      costMicros: usdToMicros((durationSeconds / 60) * soundEffectUsdPerMinute),
    };
  }

  async music(input: {
    prompt: string;
    durationSeconds: number;
  }): Promise<GeneratedAudio> {
    const durationSeconds = Math.min(600, Math.max(3, input.durationSeconds));
    const data = await this.audio(`/v1/music?output_format=${outputFormat}`, {
      prompt: input.prompt,
      music_length_ms: Math.round(durationSeconds * 1000),
      model_id: this.config.musicModel,
      force_instrumental: true,
    });
    return {
      data,
      model: this.config.musicModel,
      costMicros: usdToMicros((durationSeconds / 60) * musicUsdPerMinute),
    };
  }

  private speechRate(): number {
    return speechUsdPer1kCharacters[this.config.speechModel] ?? 0.08;
  }

  private async audio(path: string, body: JsonObject): Promise<Buffer> {
    const response = await this.send(path, {
      method: "POST",
      body: JSON.stringify(body),
    });
    const data = Buffer.from(await response.arrayBuffer());
    if (data.length === 0) {
      throw new AudioProviderResponseError("ElevenLabs returned empty audio.");
    }
    return data;
  }

  private async send(path: string, init: RequestInit): Promise<Response> {
    if (!this.config.apiKey) {
      throw new AudioProviderConfigurationError(
        "ELEVENLABS_API_KEY is required for ElevenLabs audio generation.",
      );
    }
    let response: Response;
    try {
      response = await this.request(`${baseUrl}${path}`, {
        ...init,
        headers: {
          "xi-api-key": this.config.apiKey,
          "content-type": "application/json",
        },
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (error) {
      throw new AudioProviderUnavailableError(
        error instanceof DOMException && error.name === "TimeoutError"
          ? "ElevenLabs timed out."
          : "ElevenLabs could not be reached.",
      );
    }
    if (!response.ok) {
      throw await elevenLabsError(response);
    }
    return response;
  }
}

async function elevenLabsError(response: Response): Promise<Error> {
  const detail = asObject(await safeJson(response))?.detail;
  const detailObject = asObject(detail);
  const status =
    typeof detailObject?.status === "string" ? detailObject.status : "";
  const message =
    typeof detailObject?.message === "string"
      ? detailObject.message
      : typeof detail === "string"
        ? detail
        : Array.isArray(detail) && typeof asObject(detail[0])?.msg === "string"
          ? String(asObject(detail[0])?.msg)
          : "";
  if (status === "quota_exceeded" || response.status === 402) {
    return new AudioProviderUnavailableError(
      "Your ElevenLabs credits or spending limit are used up.",
    );
  }
  if (response.status === 401 || response.status === 403) {
    return new AudioProviderConfigurationError(
      "ElevenLabs rejected the configured ELEVENLABS_API_KEY or its permissions.",
    );
  }
  if (response.status === 429) {
    return new AudioProviderUnavailableError(
      "ElevenLabs is rate limiting requests. Try again in a moment.",
    );
  }
  return new AudioProviderResponseError(
    message
      ? `ElevenLabs rejected the request: ${message.slice(0, 300)}`
      : `ElevenLabs returned HTTP ${response.status}.`,
  );
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return undefined;
  }
}

function asObject(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}
