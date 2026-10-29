"use client";

import { LoaderCircle, Mic, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  encodeWhisperWav,
  startRecording,
  transcribe,
  type DictationStatus,
  type Recorder,
} from "@/lib/dictation";
import { errorMessage, useResource } from "@/lib/kdp";

type Phase = "idle" | "starting" | "recording" | "transcribing";

const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

/**
 * Records a voice prompt and hands the text to `onText`. Speech is turned into
 * text by local Whisper on this Mac; the audio never leaves the machine.
 */
export function DictationButton({
  onText,
  disabled = false,
}: {
  onText: (text: string) => void;
  disabled?: boolean;
}) {
  const status = useResource<DictationStatus>("/kdp/dictation");
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string>();
  const recorder = useRef<Recorder | null>(null);
  const ticker = useRef<ReturnType<typeof setInterval>>(undefined);
  const request = useRef<AbortController | null>(null);
  const maxSeconds = status.data?.maxSeconds ?? 120;

  useEffect(
    () => () => {
      clearInterval(ticker.current);
      recorder.current?.cancel();
      request.current?.abort();
    },
    [],
  );

  const cancel = () => {
    clearInterval(ticker.current);
    recorder.current?.cancel();
    recorder.current = null;
    setPhase("idle");
  };

  const stop = () => {
    const active = recorder.current;
    if (!active) return;
    clearInterval(ticker.current);
    recorder.current = null;
    const recording = active.stop();
    if (recording.samples.length < recording.sampleRate * 0.4) {
      setPhase("idle");
      setError("The recording was too short. Hold on a little longer.");
      return;
    }
    if (active.peak() < 0.01) {
      setPhase("idle");
      setError("No sound reached the microphone. Check the input device.");
      return;
    }
    setPhase("transcribing");
    const controller = new AbortController();
    request.current = controller;
    transcribe(encodeWhisperWav(recording), controller.signal)
      .then((result) => {
        if (result.text) onText(result.text);
        else setError("No words were recognised. Try again a little closer.");
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(reason));
      })
      .finally(() => {
        if (request.current === controller) request.current = null;
        setPhase("idle");
      });
  };

  const start = () => {
    setError(undefined);
    setPhase("starting");
    startRecording()
      .then((active) => {
        recorder.current = active;
        const startedAt = Date.now();
        setElapsed(0);
        setPhase("recording");
        ticker.current = setInterval(() => {
          const seconds = (Date.now() - startedAt) / 1000;
          setElapsed(seconds);
          setLevel(active.level());
          if (seconds >= maxSeconds) stop();
        }, 100);
      })
      .catch((reason: unknown) => {
        setPhase("idle");
        setError(errorMessage(reason));
      });
  };

  const unavailable = status.data && !status.data.available;
  const title = unavailable
    ? (status.data?.reason ?? "Voice input is unavailable.")
    : "Speak your idea. Local Whisper turns it into text on this Mac.";

  return (
    <>
      <div className="kdp-dictation">
        {phase === "recording" ? (
          <>
            <span className="kdp-dictation-live" role="status">
              <span
                className="kdp-dictation-dot"
                style={{ transform: `scale(${1 + Math.min(level * 3, 1.2)})` }}
                aria-hidden="true"
              />
              <span className="kdp-dictation-word">Listening</span>{" "}
              {clock(elapsed)} / {clock(maxSeconds)}
            </span>
            <button
              type="button"
              className="button secondary small"
              onClick={stop}
            >
              <Square size={12} /> Stop and insert
            </button>
            <button
              type="button"
              className="button ghost small icon-only"
              onClick={cancel}
              aria-label="Discard recording"
              title="Discard recording"
            >
              <X size={14} />
            </button>
          </>
        ) : (
          <button
            type="button"
            className="button ghost small"
            onClick={start}
            disabled={disabled || unavailable || phase !== "idle"}
            title={title}
          >
            {phase === "idle" ? (
              <Mic size={14} />
            ) : (
              <LoaderCircle size={14} className="spin" />
            )}
            {phase === "transcribing"
              ? "Transcribing…"
              : phase === "starting"
                ? "Starting microphone…"
                : "Dictate"}
          </button>
        )}
      </div>
      {(error || unavailable) && (
        <small className="kdp-dictation-note" role="alert">
          {error ?? status.data?.reason}
        </small>
      )}
    </>
  );
}
