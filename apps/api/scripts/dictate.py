"""Transcribe one dictated clip with mlx-whisper and print the result as JSON.

Usage: python dictate.py CLIP.wav [--lang auto|en|de|...] [--model REPO]

The clip must be 16 kHz mono 16-bit PCM WAV, which is what the web app
records. The audio never leaves the machine. The last stdout line is
{"text": "...", "language": "en"}.
"""
import argparse
import json
import os
import sys
import wave

# The Xet download path can stall at 0 bytes; plain HTTPS works.
os.environ.setdefault("HF_HUB_DISABLE_XET", "1")

import mlx_whisper
import numpy as np
from huggingface_hub import snapshot_download

DEFAULT_MODEL = "mlx-community/whisper-large-v3-turbo"


def model_path(repo):
    # Use the cached copy without a network round trip; download only once.
    try:
        return snapshot_download(repo, local_files_only=True)
    except Exception:
        return snapshot_download(repo)


def load_clip(path):
    with wave.open(path) as clip:
        if (clip.getframerate(), clip.getnchannels(), clip.getsampwidth()) != (16000, 1, 2):
            sys.exit("expected 16 kHz mono 16-bit WAV")
        pcm = clip.readframes(clip.getnframes())
    return np.frombuffer(pcm, np.int16).astype(np.float32) / 32768.0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("clip")
    parser.add_argument("--lang", default="auto")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    args = parser.parse_args()

    audio = load_clip(args.clip)
    result = mlx_whisper.transcribe(
        audio,
        path_or_hf_repo=model_path(args.model),
        language=None if args.lang == "auto" else args.lang,
        # Each segment stands alone, so one misheard phrase does not repeat.
        condition_on_previous_text=False,
        verbose=None,
    )
    text = " ".join(
        segment["text"].strip()
        for segment in result["segments"]
        if segment["text"].strip()
    )
    print(json.dumps({"text": text, "language": result.get("language")}))


if __name__ == "__main__":
    main()
