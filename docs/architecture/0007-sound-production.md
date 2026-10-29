# ADR 0007: ElevenLabs sound production with voice profiles

- Status: Accepted
- Date: 2026-10-11

## Context

A finished reel needs narration, character dialogue, sound effects, ambience, and
music. Characters must keep the same voice across scenes, Bangla must be supported,
and generation must not spend credit without an explicit action. Rendering the
final mix is a separate later phase because FFmpeg is not installed yet.

## Decision

- ElevenLabs implements one audio provider boundary: speech, multi-speaker
  dialogue, sound effects, music, and a voice list. The key stays server-side.
- Speech and dialogue use `eleven_v4` by default, which supports Bangla and the
  Text to Dialogue API; the project language is sent as `language_code`. Sound
  effects use `eleven_text_to_sound_v2` (0.5-30 s); music uses `music_v2_5` with
  `force_instrumental`.
- A voice profile stores one voice per narrator and per character. Dialogue is
  generated only when every speaker has a profile, in one request per scene, within
  ElevenLabs' 2,000-character and ten-voice limits.
- Dialogue is parsed from scene text: a `Name: line` prefix matched by exact Bible
  name or code, otherwise the scene's first character. Story requests now ask for
  that format. Unmatched speakers are shown, never guessed.
- Every take is an immutable `audio_attempts` row with a `target_key` (narration or
  dialogue per scene, sound effects per shot, music per project). Partial unique
  indexes allow one active generation and one approved take per target.
- Generation runs in the background in the API process; takes still running when
  the process stops are marked failed at the next start. A literal confirmation
  token is required on every paid request.
- Costs are estimates from ElevenLabs' list prices per 1,000 characters or per
  minute, recorded in USD. MP3 files are verified and stored under the project's
  `audio/` folder and served with byte ranges.

## Consequences

- Narration, dialogue, effects, and music can be reviewed per scene before any
  rendering exists.
- Existing plans with unlabelled dialogue still work, attributed to the first
  scene character until the text is labelled.
- ElevenLabs bills the user's own account; the recorded cost is an estimate.
