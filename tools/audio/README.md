# Offline audio

For devices whose browser lacks a language's system TTS voice (e.g. Farsi on
Android), the app can play pre-generated audio clips instead of speaking live.

## The pipeline

```
data/<lang>/<deck>.tsv ──bundle──▶ data/<lang>/cards.json
                                          │
                  gen-audio.mjs (say + afconvert, macOS)
                                          ▼
        audio/<lang>/<deckId>/<slug>.m4a   (git-ignored scratch, 1-1 mirror)
                                          │  --zip
                                          ▼
        public/audio/<lang>.zip            (COMMITTED — the published pack)
                                          │
                    Library ▸ Load audio (fetches the pack)
                                          ▼
                   IndexedDB  (keyed by lang + card identity)
```

The packs are small (~2 MB/lang) so they ship in the repo. `audio/` (the loose
clips) stays git-ignored; only the per-language zip in `public/audio/` is
committed. The app fetches it on demand — never automatically.

The clip filename (`slug`) and spoken text both come from
[`src/study/audioKey.js`](../../src/study/audioKey.js) — the **same** module the
app uses on import — so the generator and the app can never disagree on a path.

## Generate

macOS only (needs `say` + `afconvert`, and the matching voice installed via
System Settings › Accessibility › Spoken Content).

```bash
# regenerate one folder/deck (only what changed), then publish the full pack:
node tools/audio/gen-audio.mjs farsi words/numbers --zip

# a whole language, or force-overwrite existing clips:
node tools/audio/gen-audio.mjs farsi --zip
node tools/audio/gen-audio.mjs farsi words/numbers --force --zip
```

Loose clips land in `audio/<lang>/…` (git-ignored). `--zip` always (re)builds
the **full** language pack — every clip under `audio/<lang>/`, not just the
folder this run touched — and writes it to `public/audio/<lang>.zip` (committed).
Commit that zip to publish the audio.

## Load (in the app)

**Library ▸ Load audio** fetches every `public/audio/<lang>.zip` and imports it
into IndexedDB. It runs only when clicked; click again to re-pull (it bypasses
the HTTP cache and overwrites). Each schema row shows its total entries and how
many have a clip (`audio 364/364`, green when full).

- **Import .zip** — load an ad-hoc pack from a file instead of the repo.
- **Clear all** — wipe all stored clips.

Clips are stored under each card's identity, so the right one plays automatically
when you study that card. When no clip exists, the app falls back to the live
Web Speech voice.
