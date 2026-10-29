import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import {
  DictationService,
  wavDurationSeconds,
  type ProcessResult,
  type RunProcess,
} from "../src/kdp/dictation.js";
import { createServices, type Services } from "../src/services.js";
import { multipart } from "./kdp-helpers.js";

function wav(
  seconds: number,
  { rate = 16_000, channels = 1, bits = 16 } = {},
): Buffer {
  const data = Math.round(seconds * rate) * channels * (bits / 8);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + data, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * channels * (bits / 8), 28);
  header.writeUInt16LE(channels * (bits / 8), 32);
  header.writeUInt16LE(bits, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(data, 40);
  return Buffer.concat([header, Buffer.alloc(data)]);
}

type Call = { command: string; args: string[]; env: NodeJS.ProcessEnv };

/** Stands in for the Python process, so no model runs in tests. */
function fakeWhisper(result: Partial<ProcessResult> = {}) {
  const calls: Call[] = [];
  let release: () => void = () => undefined;
  let gate: Promise<void> | null = null;
  const run: RunProcess = async (command, args, { env }) => {
    calls.push({ command, args, env });
    if (gate) await gate;
    return {
      code: 0,
      stdout:
        'loading model\n{"text": " A lighthouse keeper finds letters. ", "language": "en"}\n',
      stderr: "",
      ...result,
    };
  };
  return {
    calls,
    run,
    hold() {
      gate = new Promise((resolve) => {
        release = resolve;
      });
    },
    release: () => release(),
  };
}

// Any existing executable and file satisfy the availability check.
const installed = {
  python: process.execPath,
  script: new URL("../scripts/dictate.py", import.meta.url).pathname,
};

describe("dictation", () => {
  it("reads the duration of 16 kHz mono PCM and rejects other audio", () => {
    expect(wavDurationSeconds(wav(2.5))).toBe(2.5);
    expect(() => wavDurationSeconds(Buffer.from("not audio at all"))).toThrow(
      "not a WAV",
    );
    expect(() => wavDurationSeconds(wav(1, { rate: 48_000 }))).toThrow(
      "16 kHz mono 16-bit",
    );
    expect(() => wavDurationSeconds(wav(1, { channels: 2 }))).toThrow(
      "16 kHz mono 16-bit",
    );
  });

  it("runs local Whisper without passing secrets and returns clean text", async () => {
    const whisper = fakeWhisper();
    const previous = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "sk-test-not-a-real-key";
    try {
      const service = new DictationService({ ...installed, run: whisper.run });
      const result = await service.transcribe(wav(3), "de");
      expect(result).toEqual({
        text: "A lighthouse keeper finds letters.",
        language: "en",
        durationSeconds: 3,
      });
    } finally {
      if (previous === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previous;
    }
    const [call] = whisper.calls;
    expect(call?.command).toBe(process.execPath);
    expect(call?.args).toEqual(
      expect.arrayContaining(["--lang", "de", "--model"]),
    );
    expect(call?.env.OPENAI_API_KEY).toBeUndefined();
    expect(call?.env.HF_HUB_DISABLE_XET).toBe("1");
  });

  it("refuses short, long, concurrent and uninstalled requests", async () => {
    const whisper = fakeWhisper();
    const service = new DictationService({ ...installed, run: whisper.run });
    await expect(service.transcribe(wav(0.1))).rejects.toThrow("too short");
    await expect(service.transcribe(wav(130))).rejects.toThrow(
      "at most 2 minutes",
    );

    whisper.hold();
    const first = service.transcribe(wav(1));
    await expect(service.transcribe(wav(1))).rejects.toThrow(
      "Another recording",
    );
    whisper.release();
    await expect(first).resolves.toMatchObject({ language: "en" });

    const missing = new DictationService({
      python: path.join(tmpdir(), "no-such-python"),
      run: whisper.run,
    });
    expect(missing.status()).toMatchObject({ available: false });
    await expect(missing.transcribe(wav(1))).rejects.toThrow(
      "Local Whisper is not installed",
    );
  });

  it("reports a failed Whisper run with its last error line", async () => {
    const whisper = fakeWhisper({
      code: 1,
      stdout: "",
      stderr: "Traceback\nModuleNotFoundError: No module named 'mlx_whisper'",
    });
    const service = new DictationService({ ...installed, run: whisper.run });
    await expect(service.transcribe(wav(1))).rejects.toThrow(
      "No module named 'mlx_whisper'",
    );
  });
});

describe("dictation API", () => {
  let directory: string;
  let services: Services;
  let app: FastifyInstance;
  const whisper = fakeWhisper();

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "kdp-dictation-"));
    process.env.DATABASE_PATH = path.join(directory, "ai-studio.sqlite");
    process.env.PROJECTS_PATH = path.join(directory, "projects");
    process.env.BACKUPS_PATH = path.join(directory, "backups");
    process.env.CACHE_PATH = path.join(directory, "cache");
    services = await createServices({
      textProviders: [],
      kdpTextProviders: [],
      kdpDictation: new DictationService({ ...installed, run: whisper.run }),
    });
    app = await buildApp(
      {
        environment: "test",
        host: "127.0.0.1",
        port: 4100,
        webOrigins: new Set(["http://localhost:3000"]),
      },
      services,
    );
  });

  afterEach(async () => {
    await app.close();
    services.database.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("reports status and transcribes an uploaded recording", async () => {
    const status = await app.inject({
      method: "GET",
      url: "/api/v1/kdp/dictation",
    });
    expect(status.json()).toMatchObject({
      available: true,
      engine: "mlx-whisper",
      maxSeconds: 120,
    });

    const upload = multipart("dictation.wav", "audio/wav", wav(2));
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/kdp/dictation?language=auto",
      ...upload,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      text: "A lighthouse keeper finds letters.",
      language: "en",
      durationSeconds: 2,
    });
    expect(whisper.calls.at(-1)?.args).toEqual(
      expect.arrayContaining(["--lang", "auto"]),
    );

    const bad = await app.inject({
      method: "POST",
      url: "/api/v1/kdp/dictation",
      ...multipart("clip.wav", "audio/wav", wav(1, { rate: 44_100 })),
    });
    expect(bad.statusCode).toBe(422);

    const badLanguage = await app.inject({
      method: "POST",
      url: "/api/v1/kdp/dictation?language=../../etc",
      ...upload,
    });
    expect(badLanguage.statusCode).toBe(422);
  });
});
