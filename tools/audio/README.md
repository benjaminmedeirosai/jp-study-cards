# Offline audio

For devices whose browser lacks a language's system TTS voice (e.g. Farsi on
Android), the app can play pre-generated audio clips instead of speaking live.

## The pipeline

```
data/<lang>/<deck>.tsv ──bundle──▶ data/<lang>/cards.json
                                          │
            gen-audio.mjs --voice "Name" (say + afconvert, macOS)
                                          ▼
   audio/<lang>/<voiceId>/<deckId>/<slug>.m4a  (git-ignored scratch)
                                          │  --zip
                                          ▼
   public/audio/<lang>.zip + manifest.json     (COMMITTED — published)
                                          │
                    Library ▸ Load audio (fetches the pack)
                                          ▼
       IndexedDB  (keyed by lang + voice + card identity)
```

A word can have several voices side by side (`audio/<lang>/<voiceId>/…`). At
playback the app walks the user's voice-priority order (Settings ▸ Voice &
speed), then falls back to live TTS.

The packs are small (~2 MB/lang) so they ship in the repo. `audio/` (the loose
clips) stays git-ignored; only the per-language zip in `public/audio/` is
committed. The app fetches it on demand — never automatically.

The clip filename (`slug`) and spoken text both come from
[`src/audio/audioKey.js`](../../src/audio/audioKey.js) — the **same** module the
app uses on import — so the generator and the app can never disagree on a path.

## Generate

macOS only (needs `say` + `afconvert`, and the matching voice installed via
System Settings › Accessibility › Spoken Content).

```bash
# default voice (auto-resolved from the language's tts locale):
node tools/audio/gen-audio.mjs farsi --zip

# a specific voice — run once per voice you want, then --zip on the last:
node tools/audio/gen-audio.mjs spanish adjectives --voice "Carlos (Enhanced)"
node tools/audio/gen-audio.mjs spanish adjectives --voice "Paulina (Enhanced)" --zip

# one folder, force re-synth:
node tools/audio/gen-audio.mjs farsi words/numbers --force --zip
```

`--voice "Name"` picks an installed `say` voice (see `say -v '?'`); omit it to
auto-pick the language's voice. Each voice's clips live under
`audio/<lang>/<voiceId>/…`, so multiple voices coexist. Loose clips are
git-ignored. `--zip` always (re)builds the **full** language pack — every voice
and clip under `audio/<lang>/` — writes `public/audio/<lang>.zip`, and updates
`public/audio/manifest.json` (per-language content version + each voice's name &
clip count). Commit the zip + manifest to publish.

## Load (in the app)

**Library ▸ Load audio** fetches every `public/audio/<lang>.zip` and imports it
into IndexedDB. It runs only when clicked; click again to re-pull (it bypasses
the HTTP cache and overwrites). Each schema row shows its total entries and how
many have a clip (`audio 364/364`, green when full).

- **Import .zip** — load an ad-hoc pack from a file instead of the repo.
- **Clear all** — wipe all stored clips.

Clips are stored under each card's identity + voice. Playback walks the
**voice-priority** list (Settings ▸ Voice & speed — reorder with ↑/↓) and plays
the first voice that has a clip; with none, or with "Use stored audio if
available" off, it falls back to the live Web Speech voice.
