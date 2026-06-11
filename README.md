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

Study data is organized **one tree per language** (a "library" in the app) under
`data/<lang>/`, as per-deck `.tsv` files, and the **folder tree is the source of
truth** — there's no manifest. A deck's category, label, and id are derived from
its path and filename (`data/japanese/words/adjectives/na-adjectives/qualities.tsv`
→ category "Words / Adjectives / Na Adjectives", label "Qualities"). Each language
is built into its own bundle, `data/<lang>/cards.json`, that the app fetches when
that library is active (see `src/study/libraries.js`).

The workflow:

1. Add/edit a `.tsv` deck (Japanese header: `kanji  hiragana  type  english`).
   Put it in a folder under the language tree that spells out the category you
   want; the filename becomes the label (override with a `# label:` header line).
2. Rebuild that language's bundle (or all):

   ```bash
   node tools/bundle-data.mjs japanese   # one language
   node tools/bundle-data.mjs            # every language
   ```

**See [`data/AGENTS.md`](data/AGENTS.md) for the layout, and
[`data/japanese/AGENTS.md`](data/japanese/AGENTS.md) for the full Japanese data
conventions** — folder layout, TSV format, the kana split, classification rules.

To audit coverage, run `node tools/japanese/audit-data.mjs` (after building). It writes
throwaway dev-reference reports to `tmp/` (gitignored): `kanji-coverage-1.json`
and `kanji-coverage-2.json` (kanji appearing in only one / two distinct words —
characters that could use more coverage) and `duplicates.json` (word forms that
occur in more than one place). None are committed or consumed by the app.

## Offline

The service worker (`sw.js`) is network-first for any request under `/data/`:
every load fetches the latest `data/<lang>/cards.json` from the server and
refreshes the cache, falling back to the cache only when offline. A plain refresh
always picks up a freshly built bundle; the cached copy keeps the app working
offline.
