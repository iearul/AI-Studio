"use client";

import { apiFetch } from "@/lib/api";

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

export type Recording = { samples: Float32Array; sampleRate: number };

export type Recorder = {
  /** Loudest recent sample, 0–1, for the level meter. */
  level: () => number;
  /** Loudest sample of the whole recording, to catch a muted microphone. */
  peak: () => number;
  stop: () => Recording;
  cancel: () => void;
};

const whisperRate = 16_000;

// Copies each 128-sample block of microphone input to the page.
const captureWorklet = `
class DictationCapture extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) this.port.postMessage(channel.slice(0));
    return true;
  }
}
registerProcessor("dictation-capture", DictationCapture);
`;

function microphoneError(reason: unknown): Error {
  const name = reason instanceof DOMException ? reason.name : "";
  if (name === "NotAllowedError" || name === "SecurityError")
    return new Error(
      "Microphone access is blocked. Allow it for this site in the browser's settings.",
    );
  if (name === "NotFoundError" || name === "OverconstrainedError")
    return new Error("No microphone was found.");
  if (name === "NotReadableError")
    return new Error("Another app is using the microphone.");
  return reason instanceof Error ? reason : new Error("Recording failed.");
}

/** Records mono microphone audio as raw samples until stopped. */
export async function startRecording(): Promise<Recorder> {
  if (
    !navigator.mediaDevices?.getUserMedia ||
    typeof AudioWorkletNode === "undefined"
  )
    throw new Error(
      "This browser cannot record here. Open the app at localhost in Chrome, Edge, Safari or Firefox.",
    );
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  } catch (reason) {
    throw microphoneError(reason);
  }
  const context = new AudioContext();
  const release = () => {
    for (const track of stream.getTracks()) track.stop();
    void context.close();
  };
  try {
    const url = URL.createObjectURL(
      new Blob([captureWorklet], { type: "text/javascript" }),
    );
    try {
      await context.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    await context.resume();
    const source = context.createMediaStreamSource(stream);
    const capture = new AudioWorkletNode(context, "dictation-capture");
    // A silent path to the speakers keeps the capture node running.
    const mute = context.createGain();
    mute.gain.value = 0;
    source.connect(capture).connect(mute).connect(context.destination);

    const blocks: Float32Array[] = [];
    let level = 0;
    let peak = 0;
    capture.port.onmessage = (event: MessageEvent<Float32Array>) => {
      blocks.push(event.data);
      let blockPeak = 0;
      for (const value of event.data)
        blockPeak = Math.max(blockPeak, Math.abs(value));
      level = Math.max(blockPeak, level * 0.97);
      peak = Math.max(peak, blockPeak);
    };
    const finish = () => {
      capture.port.onmessage = null;
      source.disconnect();
      release();
    };
    return {
      level: () => level,
      peak: () => peak,
      cancel: finish,
      stop() {
        finish();
        const length = blocks.reduce((sum, block) => sum + block.length, 0);
        const samples = new Float32Array(length);
        let offset = 0;
        for (const block of blocks) {
          samples.set(block, offset);
          offset += block.length;
        }
        return { samples, sampleRate: context.sampleRate };
      },
    };
  } catch (reason) {
    release();
    throw microphoneError(reason);
  }
}

/** Downsamples to 16 kHz and encodes 16-bit PCM WAV, the format Whisper reads. */
export function encodeWhisperWav({ samples, sampleRate }: Recording): Blob {
  const ratio = sampleRate / whisperRate;
  const length = Math.floor(samples.length / ratio);
  const pcm = new Int16Array(length);
  for (let index = 0; index < length; index += 1) {
    // Averaging each window is a simple low-pass filter, enough for speech.
    const start = Math.floor(index * ratio);
    const end = Math.max(start + 1, Math.floor((index + 1) * ratio));
    let sum = 0;
    for (let at = start; at < end; at += 1) sum += samples[at] ?? 0;
    const value = Math.max(-1, Math.min(1, sum / (end - start)));
    pcm[index] = Math.round(value * 0x7fff);
  }
  const header = new DataView(new ArrayBuffer(44));
  const ascii = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1)
      header.setUint8(offset + index, text.charCodeAt(index));
  };
  ascii(0, "RIFF");
  header.setUint32(4, 36 + pcm.byteLength, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  header.setUint32(16, 16, true);
  header.setUint16(20, 1, true);
  header.setUint16(22, 1, true);
  header.setUint32(24, whisperRate, true);
  header.setUint32(28, whisperRate * 2, true);
  header.setUint16(32, 2, true);
  header.setUint16(34, 16, true);
  ascii(36, "data");
  header.setUint32(40, pcm.byteLength, true);
  return new Blob([header.buffer, pcm.buffer], { type: "audio/wav" });
}

export function transcribe(
  audio: Blob,
  signal?: AbortSignal,
): Promise<DictationResult> {
  const form = new FormData();
  form.append("file", audio, "dictation.wav");
  return apiFetch<DictationResult>("/kdp/dictation?language=auto", {
    method: "POST",
    body: form,
    signal,
  });
}

/** Adds dictated text after what is already written. */
export function appendDictation(
  current: string,
  text: string,
  maxLength: number,
): string {
  const spoken = text.trim();
  if (!spoken) return current;
  const joiner = !current || /\s$/.test(current) ? "" : " ";
  return `${current}${joiner}${spoken}`.slice(0, maxLength);
}
