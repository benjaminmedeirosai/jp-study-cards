# TODO

## Reading view for text passages (`#/reading`)

The **data layer** for reading texts is done and shipped (see
[`data/AGENTS.md` → "Reading texts"](data/AGENTS.md)). Each passage lives in
`data/texts/<slug>/` as three files — `blob.txt` (full reference text),
`sentences.tsv` (Japanese line / English), `words.tsv` (a normal studyable
deck). The bundler emits a **`texts` array** into `data/cards.json`:

```json
{ "id": "texts/intro-japan", "label": "...", "category": "Texts",
  "blob": "…", "sentences": [{ "japanese": "…", "english": "…" }],
  "wordsDeckId": "texts/intro-japan/words" }
```

This array currently sits in `cards.json` **unused by the app**. The remaining
work is the in-app view that consumes it.

### What to build (when we want it — not yet)

- A new hash route `#/reading` (and a per-text route, e.g. `#/reading/<slug>`),
  wired in `src/main.js` alongside the existing card/decks/settings pages.
- A picker listing the available texts (from `bundle.texts`).
- A reading view that shows:
  - the **blob** as reference (collapsible — "the blob is really just
    reference"),
  - the **sentences** one per line, each with tap/click-to-reveal English,
  - a jump into studying the passage's **word deck** (`wordsDeckId`) in the
    existing card UI — study the words first, then read the sentences.
- No service-worker change needed (texts ride inside `cards.json`, which the
  SW already network-first-caches under `/data/`).

### Open questions parked for then

- Should the text word-decks stay in the normal deck browser / "All decks"
  pool, or be reachable only from the reading view? (Currently they're normal
  studyable decks.)
- Sub-grouping `data/texts/` (e.g. `songs/`, `articles/`) if passages grow.
