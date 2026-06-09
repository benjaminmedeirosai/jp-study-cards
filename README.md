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

Study data lives under `data/` as per-deck `.tsv` files, and the **folder tree is
the source of truth** — there's no manifest. A deck's category, label, and id are
derived from its path and filename (`data/adjectives/na-adjectives/qualities.tsv`
→ category "Adjectives / Na Adjectives", label "Qualities"). The app fetches a
single built bundle, `data/cards.json`, at startup.

The workflow:

1. Add/edit a `.tsv` deck (header: `kanji  hiragana  type  english`). Put it in a
   folder that spells out the category you want; the filename becomes the label
   (override with a `# label:` header line for symbols/kanji).
2. Rebuild the bundle:

   ```bash
   node tools/bundle-data.mjs
   ```

**See [`data/AGENTS.md`](data/AGENTS.md) for the full data conventions** — folder
layout, TSV format, the kana split, classification rules, and comment headers.

To audit coverage, run `node tools/audit-data.mjs` (after building). It writes
throwaway dev-reference reports to `tmp/` (gitignored): `kanji-coverage-1.json`
and `kanji-coverage-2.json` (kanji appearing in only one / two distinct words —
characters that could use more coverage) and `duplicates.json` (word forms that
occur in more than one place). None are committed or consumed by the app.

> `tools/generate-data.mjs` is **legacy**: it regenerates `data/` from an
> external source collection and overwrites the hand-curated TSV decks. Don't run
> it against the curated data.

## Offline

The service worker (`sw.js`) is network-first for any request under `/data/`:
every load fetches the latest `data/cards.json` from the server and refreshes
the cache, falling back to the cache only when offline. A plain refresh always
picks up a freshly built bundle; the cached copy keeps the app working offline.
