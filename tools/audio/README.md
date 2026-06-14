# Offline audio

For devices whose browser lacks a language's system TTS voice (e.g. Farsi on
Android), the app can play pre-generated audio clips instead of speaking live.

## The pipeline

```
data/<lang>/<deck>.tsv ──bundle──▶ data/<lang>/cards.json
                                          │
                  gen-audio.mjs (say + afconvert, macOS)
                                          ▼
        audio/<lang>/<deckId>/<slug>.m4a   (git-ignored, 1-1 mirror of data/)
                                          │
                         zip ──▶ Google Drive ──▶ phone
                                          ▼
            Settings ▸ Offline audio ▸ Import audio (.zip)
                                          ▼
                   IndexedDB  (keyed by lang + card identity)
```

The clip filename (`slug`) and spoken text both come from
[`src/study/audioKey.js`](../../src/study/audioKey.js) — the **same** module the
app uses on import — so the generator and the app can never disagree on a path.

## Generate

macOS only (needs `say` + `afconvert`, and the matching voice installed via
System Settings › Accessibility › Spoken Content).

```bash
# one folder/deck (regenerate just what changed) — also writes a .zip:
node tools/audio/gen-audio.mjs farsi alphabet --zip

# a whole language, or force-overwrite existing clips:
node tools/audio/gen-audio.mjs farsi
node tools/audio/gen-audio.mjs farsi words/numbers --force
```

Output lands in `audio/<lang>/…` (git-ignored). `--zip` packs the generated
subtree as `audio/<lang>-<deck>.zip` with paths relative to `audio/`, which is
exactly what the in-app importer expects.

## Import (on device)

Transfer the zip however you like (Google Drive, etc.), then in the app:
**Settings ▸ Offline audio ▸ Import audio (.zip)** → pick the file. One zip can
contain many decks/languages; each clip is stored under its card's identity and
played automatically when you study that card. "Clear" removes the current
library's clips.

When no clip exists for a card, the app falls back to the live Web Speech voice.
