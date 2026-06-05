# Japanese Study Cards Lite

Zero-build static PWA for the lightweight Japanese study flow.

This repo intentionally avoids the larger Study Cards shell/configuration system. It should stay focused on the simple offline study experience.

## Local Serve

```bash
python3 -m http.server 4173
```

Then open:

```text
http://localhost:4173
```

## Generate Data

The lightweight data files are generated from the main repo source collection:

```bash
node tools/generate-data.mjs
```

Override the source path when needed:

```bash
JP_WORDS_SOURCE=/path/to/japanese_words.json node tools/generate-data.mjs
```

The generator writes topic folders under `data/` and refreshes `data/index.json`. Each study record keeps only:

```json
{ "kanji": "食べ物", "hiragana": "たべもの", "type": "noun", "english": "food" }
```

## Offline Resync

The service worker caches the app shell, `data/index.json`, and every deck file listed in the index. The app can request a full resync with a `RESYNC_CACHE` service-worker message.

## Current Status

Extraction scaffold plus regenerated lightweight data are ready. The next step is to port the Japanese study UI into `src/study/` and load decks through `/data/index.json`.
