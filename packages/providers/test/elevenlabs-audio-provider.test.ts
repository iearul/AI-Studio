import { describe, expect, it, vi } from "vitest";

import {
  AudioProviderConfigurationError,
  AudioProviderUnavailableError,
} from "../src/audio-provider.js";
import { ElevenLabsAudioProvider } from "../src/elevenlabs-audio-provider.js";

const config = {
  apiKey: "test-key",
  speechModel: "eleven_v4",
  musicModel: "music_v2_5",
  timeoutMs: 10_000,
};
const mp3 = Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00]);

type Captured = { url: string; headers: Headers; body: unknown };

function capture(response: () => Response) {
  const calls: Captured[] = [];
  const request = vi.fn<typeof fetch>((input, init) => {
    calls.push({
      url: input instanceof Request ? input.url : input.toString(),
      headers: new Headers(init?.headers),
      body:
        typeof init?.body === "string"
          ? (JSON.parse(init.body) as unknown)
          : undefined,
    });
    return Promise.resolve(response());
  });
  return { calls, request };
}

const audioResponse = () =>
  new Response(mp3, { headers: { "content-type": "audio/mpeg" } });

describe("ElevenLabs audio provider", () => {
  it("speaks narration with the voice, model, and project language", async () => {
    const { calls, request } = capture(audioResponse);
    const provider = new ElevenLabsAudioProvider(config, request);

    const audio = await provider.speech({
      voiceId: "voice-narrator",
      text: "a".repeat(500),
      languageCode: "bn",
    });

    expect(calls[0]?.url).toBe(
      "https://api.elevenlabs.io/v1/text-to-speech/voice-narrator?output_format=mp3_44100_128",
    );
    expect(calls[0]?.headers.get("xi-api-key")).toBe("test-key");
    expect(calls[0]?.body).toEqual({
      text: "a".repeat(500),
      model_id: "eleven_v4",
      language_code: "bn",
    });
    expect(audio).toEqual({
      data: mp3,
      model: "eleven_v4",
      costMicros: 40_000,
    });
  });

  it("voices a multi-speaker scene in one dialogue request", async () => {
    const { calls, request } = capture(audioResponse);
    const provider = new ElevenLabsAudioProvider(config, request);

    await provider.dialogue({
      turns: [
        { voiceId: "voice-rahim", text: "Who is there?" },
        { voiceId: "voice-mira", text: "Only the wind." },
      ],
      languageCode: null,
    });

    expect(calls[0]?.url).toBe(
      "https://api.elevenlabs.io/v1/text-to-dialogue?output_format=mp3_44100_128",
    );
    expect(calls[0]?.body).toEqual({
      inputs: [
        { text: "Who is there?", voice_id: "voice-rahim" },
        { text: "Only the wind.", voice_id: "voice-mira" },
      ],
      model_id: "eleven_v4",
    });
  });

  it("clamps sound-effect length and prices music by duration", async () => {
    const { calls, request } = capture(audioResponse);
    const provider = new ElevenLabsAudioProvider(config, request);

    const effect = await provider.soundEffect({
      prompt: "Rain on a tin roof",
      durationSeconds: 45,
    });
    const music = await provider.music({
      prompt: "Tense strings",
      durationSeconds: 60,
    });

    expect(calls[0]?.body).toMatchObject({
      text: "Rain on a tin roof",
      duration_seconds: 30,
      model_id: "eleven_text_to_sound_v2",
    });
    expect(effect.costMicros).toBe(60_000);
    expect(calls[1]?.url).toBe(
      "https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128",
    );
    expect(calls[1]?.body).toEqual({
      prompt: "Tense strings",
      music_length_ms: 60_000,
      model_id: "music_v2_5",
      force_instrumental: true,
    });
    expect(music.costMicros).toBe(150_000);
  });

  it("lists voices across pages", async () => {
    const pages = [
      {
        voices: [
          {
            voice_id: "v1",
            name: "Rachel",
            category: "premade",
            labels: { gender: "female", accent: "american" },
            preview_url: "https://storage.example/v1.mp3",
          },
        ],
        has_more: true,
        next_page_token: "page-2",
      },
      { voices: [{ voice_id: "v2", name: "Arjun" }], has_more: false },
    ];
    const { calls, request } = capture(() => Response.json(pages.shift()));
    const provider = new ElevenLabsAudioProvider(config, request);

    await expect(provider.listVoices()).resolves.toEqual([
      {
        voiceId: "v1",
        name: "Rachel",
        category: "premade",
        description: null,
        labels: { gender: "female", accent: "american" },
        previewUrl: "https://storage.example/v1.mp3",
      },
      {
        voiceId: "v2",
        name: "Arjun",
        category: null,
        description: null,
        labels: {},
        previewUrl: null,
      },
    ]);
    expect(calls[1]?.url).toContain("next_page_token=page-2");
  });

  it("explains used-up credits and rejected keys", async () => {
    const quota = new ElevenLabsAudioProvider(
      config,
      vi.fn<typeof fetch>(() =>
        Promise.resolve(
          Response.json(
            { detail: { status: "quota_exceeded", message: "Over quota" } },
            { status: 401 },
          ),
        ),
      ),
    );
    await expect(
      quota.speech({ voiceId: "v", text: "Hello", languageCode: null }),
    ).rejects.toThrow(AudioProviderUnavailableError);

    const rejected = new ElevenLabsAudioProvider(
      config,
      vi.fn<typeof fetch>(() =>
        Promise.resolve(
          Response.json(
            { detail: { status: "invalid_api_key" } },
            { status: 401 },
          ),
        ),
      ),
    );
    await expect(
      rejected.speech({ voiceId: "v", text: "Hello", languageCode: null }),
    ).rejects.toThrow("rejected the configured ELEVENLABS_API_KEY");
  });

  it("reports a missing key without making network requests", async () => {
    const request = vi.fn<typeof fetch>();
    const provider = new ElevenLabsAudioProvider(
      { ...config, apiKey: null },
      request,
    );

    expect(provider.status()).toMatchObject({ configured: false });
    await expect(provider.listVoices()).rejects.toThrow(
      AudioProviderConfigurationError,
    );
    expect(request).not.toHaveBeenCalled();
  });
});
