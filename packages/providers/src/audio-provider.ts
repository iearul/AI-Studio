import type { AudioProviderStatus, Voice } from "@ai-film-studio/contracts";

export type GeneratedAudio = {
  data: Buffer;
  model: string;
  costMicros: number;
};

export type DialogueTurn = { voiceId: string; text: string };

export interface AudioProvider {
  readonly id: "elevenlabs";
  status(): AudioProviderStatus;
  listVoices(): Promise<Voice[]>;
  speech(input: {
    voiceId: string;
    text: string;
    languageCode: string | null;
  }): Promise<GeneratedAudio>;
  dialogue(input: {
    turns: DialogueTurn[];
    languageCode: string | null;
  }): Promise<GeneratedAudio>;
  soundEffect(input: {
    prompt: string;
    durationSeconds: number;
  }): Promise<GeneratedAudio>;
  music(input: {
    prompt: string;
    durationSeconds: number;
  }): Promise<GeneratedAudio>;
}

export class AudioProviderConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AudioProviderConfigurationError";
  }
}

export class AudioProviderUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AudioProviderUnavailableError";
  }
}

export class AudioProviderResponseError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AudioProviderResponseError";
  }
}
