import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The web app records 16 kHz mono 16-bit PCM, which Whisper uses directly. */
export const dictationSampleRate = 16_000;
export const maxDictationSeconds = 120;

export class DictationUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DictationUnavailableError";
  }
}

export class DictationInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DictationInputError";
  }
}

export class DictationBusyError extends Error {
  constructor() {
    super("Another recording is being transcribed. Try again in a moment.");
    this.name = "DictationBusyError";
  }
}

export type DictationStatus = {
  available: boolean;
  engine: "mlx-whisper";
  model: string;
  maxSeconds: number;
  reason: string | null;
};

export type DictationResult = {
  text: string;
  language: string | null;
  durationSeconds: number;
};

export type ProcessResult = {
  code: number | null;
  stdout: string;
  stderr: string;
};

export type RunProcess = (
  command: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv; timeoutMs: number },
) => Promise<ProcessResult>;

export type DictationOptions = {
  python?: string;
  script?: string;
  model?: string;
  timeoutMs?: number;
  run?: RunProcess;
};

/** Variables the transcriber needs; API keys and other secrets stay behind. */
const passedEnv = [
  "HOME",
  "PATH",
  "TMPDIR",
  "LANG",
  "HF_HOME",
  "HF_HUB_CACHE",
  "HF_ENDPOINT",
  "XDG_CACHE_HOME",
];

const runProcess: RunProcess = (command, args, { env, timeoutMs }) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: timeoutMs,
      killSignal: "SIGKILL",
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-4_000);
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (signal) stderr += `\nStopped by ${signal}.`;
      resolve({ code, stdout, stderr });
    });
  });

/** Reads the duration of a 16 kHz mono 16-bit PCM WAV, or explains why not. */
export function wavDurationSeconds(buffer: Buffer): number {
  if (
    buffer.length < 44 ||
    buffer.toString("ascii", 0, 4) !== "RIFF" ||
    buffer.toString("ascii", 8, 12) !== "WAVE"
  )
    throw new DictationInputError("The recording is not a WAV file.");
  let offset = 12;
  let format: {
    pcm: boolean;
    channels: number;
    rate: number;
    bits: number;
  } | null = null;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt " && size >= 16 && body + 16 <= buffer.length) {
      format = {
        pcm: buffer.readUInt16LE(body) === 1,
        channels: buffer.readUInt16LE(body + 2),
        rate: buffer.readUInt32LE(body + 4),
        bits: buffer.readUInt16LE(body + 14),
      };
    } else if (id === "data") {
      if (
        !format?.pcm ||
        format.channels !== 1 ||
        format.rate !== dictationSampleRate ||
        format.bits !== 16
      )
        throw new DictationInputError(
          "The recording must be 16 kHz mono 16-bit PCM.",
        );
      const bytes = Math.min(size, buffer.length - body);
      return bytes / (dictationSampleRate * 2);
    }
    offset = body + size + (size % 2);
  }
  throw new DictationInputError("The recording has no audio data.");
}

/**
 * Turns dictated speech into text with mlx-whisper on this Mac. Each clip runs
 * in a short-lived Python process; one clip at a time keeps memory in check.
 */
export class DictationService {
  private readonly python: string;
  private readonly script: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly run: RunProcess;
  private busy = false;

  constructor(options: DictationOptions = {}) {
    this.python =
      options.python ??
      process.env.KDP_WHISPER_PYTHON ??
      path.join(os.homedir(), ".local/share/mlx-whisper/venv/bin/python");
    this.script =
      options.script ??
      fileURLToPath(new URL("../../scripts/dictate.py", import.meta.url));
    this.model =
      options.model ??
      process.env.KDP_WHISPER_MODEL ??
      "mlx-community/whisper-large-v3-turbo";
    this.timeoutMs = options.timeoutMs ?? 180_000;
    this.run = options.run ?? runProcess;
  }

  status(): DictationStatus {
    let reason: string | null = null;
    try {
      accessSync(this.python, constants.X_OK);
      accessSync(this.script, constants.R_OK);
    } catch {
      reason = `Local Whisper is not installed: ${this.python} is missing. Set KDP_WHISPER_PYTHON to a Python with mlx-whisper.`;
    }
    return {
      available: reason === null,
      engine: "mlx-whisper",
      model: this.model,
      maxSeconds: maxDictationSeconds,
      reason,
    };
  }

  async transcribe(wav: Buffer, language = "auto"): Promise<DictationResult> {
    const durationSeconds = wavDurationSeconds(wav);
    if (durationSeconds < 0.3)
      throw new DictationInputError("The recording is too short.");
    if (durationSeconds > maxDictationSeconds + 5)
      throw new DictationInputError(
        `Recordings can be at most ${maxDictationSeconds / 60} minutes long.`,
      );
    const status = this.status();
    if (status.reason !== null)
      throw new DictationUnavailableError(status.reason);
    if (this.busy) throw new DictationBusyError();
    this.busy = true;
    const folder = await mkdtemp(path.join(os.tmpdir(), "kdp-dictation-"));
    try {
      const clip = path.join(folder, "clip.wav");
      await writeFile(clip, wav);
      const env: NodeJS.ProcessEnv = { HF_HUB_DISABLE_XET: "1" };
      for (const key of passedEnv)
        if (process.env[key]) env[key] = process.env[key];
      const result = await this.run(
        this.python,
        [this.script, clip, "--lang", language, "--model", this.model],
        { env, timeoutMs: this.timeoutMs },
      );
      const last = result.stdout.trim().split("\n").at(-1) ?? "";
      if (result.code !== 0 || !last.startsWith("{"))
        throw new DictationUnavailableError(
          `Local Whisper failed: ${result.stderr.trim().split("\n").at(-1) || `exit code ${result.code}`}`,
        );
      const parsed = JSON.parse(last) as {
        text?: unknown;
        language?: unknown;
      };
      return {
        text: typeof parsed.text === "string" ? parsed.text.trim() : "",
        language: typeof parsed.language === "string" ? parsed.language : null,
        durationSeconds: Math.round(durationSeconds * 10) / 10,
      };
    } finally {
      this.busy = false;
      await rm(folder, { recursive: true, force: true });
    }
  }
}
