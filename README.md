# Japanese Study Cards Lite

Zero-build static PWA for the lightweight Japanese study flow.

This repo intentionally avoids the larger Study Cards shell/configuration system. It should stay focused on the simple offline study experience.

## Local Serve

```bash
node tools/dev-server.mjs
```

Then open http://localhost:8124. The dev server sends `Cache-Control: no-store`,
so the browser never serves stale JS/CSS while iterating (any static server
works too, e.g. `python3 -m http.server`).

## Data

Study data lives under `data/` as per-deck `.tsv` (and some legacy `.json`)
files. They are the editable source of truth; the app fetches a single built
bundle, `data/cards.json`, at startup.

The workflow:

1. Edit a deck file, or add a new one (TSV header: `kanji  hiragana  type  english`).
2. If you added/removed/moved a deck, update the manifest `data/index.json`.
3. Rebuild the bundle:

   ```bash
   node tools/bundle-data.mjs
   ```

**See [`data/AGENTS.md`](data/AGENTS.md) for the full data conventions** — folder
layout, TSV format, the kana split, classification rules, and comment headers.

> `tools/generate-data.mjs` is **legacy**: it regenerates `data/` from an
> external source collection and overwrites the hand-curated TSV decks. Don't run
> it against the curated data.

## Offline

The service worker (`sw.js`) is cache-first for any request under `/data/`, so
`data/cards.json` stays available offline once the app has been visited. On
activation it clears older app caches. Rebuilding the bundle serves fresh data
on the next online load.
