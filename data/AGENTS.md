# Data layout

Study-card data is organized **one tree per language** (a "library" in the app):

```
data/<lang>/<…folders…>/<deck>.tsv   ← source of truth for that language
data/<lang>/cards.json                ← built bundle the app fetches (generated)
```

- Each language declares its TSV schema in `tools/bundle-data.mjs` (`SCHEMAS`).
- Bundle one language: `node tools/bundle-data.mjs <lang>`; all: `node tools/bundle-data.mjs`.
- `cards.json` files are **generated** — never hand-edit them.
- The app picks a language via the library registry (`src/core/libraries.js`),
  which maps each library to its `data/<lang>/cards.json`.

Per-language editing conventions live with that language's data:

- **Japanese** — `data/japanese/AGENTS.md` (folder layout, gloss rules, kanji
  coverage, the migration/wave process). Japanese-specific tooling is under
  `tools/japanese/`.
