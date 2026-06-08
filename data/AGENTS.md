# Data conventions

Rules for editing the study-card data under `data/`. Read this before adding,
reorganizing, or reclassifying decks.

## Pipeline (how data flows)

```
per-deck files (.tsv or .json)   ← editable source of truth
        │
   data/index.json               ← hand-curated manifest (lists every deck)
        │  node tools/bundle-data.mjs
        ▼
   data/cards.json                ← built runtime artifact (app fetches this once)
```

- **Edit the per-deck files**, then update `index.json`, then run
  `node tools/bundle-data.mjs`.
- `data/cards.json` is **generated** — never hand-edit it.
- ⚠️ `tools/generate-data.mjs` is **legacy**. It wipes `data/` and rebuilds JSON
  decks from an external source collection, destroying the hand-curated TSVs.
  Do **not** run it against the curated data.

## File format

New decks are **TSV** (tab-separated). Header is required and must be exactly:

```
kanji	hiragana	type	english
```

- One entry per line, tab-separated, four columns only.
- For words written in kana, put the kana form in **both** `kanji` and
  `hiragana` (e.g. `プリン	プリン	noun	custard pudding`).
- Legacy `.json` decks (array of `{kanji, hiragana, type, english}`) still work;
  prefer TSV for anything new or reorganized.

### Comment header (`#`)

Start each TSV with a `#` comment block describing **what belongs in the deck**,
so it's obvious which file a new word goes to. Lines beginning with `#` are
ignored by the bundler. Keep it to a few lines, and note the nearest sibling
decks a borderline word might go to instead:

```
# Feelings & states — how someone feels and what they like.
# Belongs here: emotions and states (元気, 心配), plus likes/dislikes (好き).
# A thing's worth goes in value.tsv, not here.
kanji	hiragana	type	english
元気	げんき	na-adjective	healthy; energetic; fine; well
```

## Folder layout

```
data/<part-of-speech>/<domain>/<subcategory>.tsv
```

- The deck `id` is the path minus extension (e.g. `nouns/food/loanwords`).
- Group by meaning, not by arbitrary 50-card chunks (`common-1`, `common-2`…).
  The old chunked JSON files are what we're migrating away from.

### `index.json` entry shape

```json
{
  "id": "na-adjective/core",
  "label": "Na-adjectives",
  "category": "Adjectives / Na-adjectives",
  "path": "/data/na-adjective/core.tsv"
}
```

- `category` uses `"Parent / Child"` to nest a deck under a subheading
  (e.g. `"Nouns / Food"`, `"Adjectives / Na-adjectives"`). Plain `"Grammar"`
  for top-level groups.
- **No `count` field.** Card counts are derived from the data files by
  `bundle-data.mjs` and written into `cards.json`. `index.json` only records
  which decks exist and where — never hand-maintain counts.

## Classification principles

1. **Folder/category = how you study it; `type` = what it actually is.**
   The two need not match. Example: 〜そう appearance forms live in
   `grammar-pattern/` (a concept), but each keeps `type: na-adjective` because
   that is how it conjugates.

2. **Kana split — `core.tsv` vs `core-kana.tsv`.**
   `core.tsv` holds kanji-written words. A `*-kana.tsv` file holds a word **only
   if it genuinely appears in kana in real text** (e.g. きれい, だめ) — never a
   mechanical kana mirror of every kanji entry. The kanji form stays in `core`;
   the kana form is a curated, separate entry.

3. **Dedup.** Each form appears once. Drop plain repeats (same word, no kana-
   frequency justification). Keep kanji + kana as two intentional entries only
   when rule 2 applies.

4. **Derived grammar forms leave the vocab decks.** Conjugation and productive
   suffix/pattern forms do **not** belong in a part-of-speech vocab deck — move
   them to `data/grammar-pattern/` (category `Grammar`), keeping the `type` that
   reflects how they inflect. Examples already there: `appearance-sou` (〜そう),
   `i-adjective-conjugation` (〜くない/〜かった), `derived-i-adjective`
   (〜やすい/〜にくい/〜っぽい). The na-adjective `suffix-teki` deck (〜的) and the
   morpheme `prefixes`/`suffixes` decks are the same idea: group by shared form.

5. **Readings are hiragana** in the `hiragana` column — including kanji on'yomi
   (write `そく`, not `ソク`). The only katakana readings are genuine loanwords
   (e.g. `トランス`). Normalize when migrating older data that mixed scripts.

## Migrating a legacy folder

This is the repeating cleanup we apply one folder at a time, turning the old
chunked `common-N.json` decks into themed TSVs. The pattern, in order:

1. **Read** every `common-N.json` in the folder; understand the full word list.
2. **Group by meaning** into themed decks (e.g. i-adjective → size, taste,
   feelings, colors…). Name files by theme, not number.
3. **Pull out derived/grammar forms** to `grammar-pattern/` (rule 4 above):
   conjugations, 〜そう, 〜やすい, 〜的, etc.
4. **Apply the kana split** (rule 2): a `kana.tsv` for words genuinely common in
   kana; the kanji form stays in its theme.
5. **Dedup** (rule 3) and **normalize readings to hiragana** (rule 5). Fix any
   wrong readings spotted along the way.
6. **Add a `#` comment header** to every new TSV saying what belongs in it.
7. **Add more common words** as fits each theme — the goal is good coverage of
   the part of speech, not just whatever the source happened to contain.
8. **Update `index.json`**: remove the old `common-N` entries, add the new decks.
   Themed decks use a `"<Parent> / <Child>"` category to nest together.
9. **Delete the old `.json` files** and run the bundler.

Done so far: `na-adjective`, `morpheme`, `i-adjective`, `numeral`, `counter`,
`proper-nouns`, `nouns` (full — all common-N.json classified into ~24 domains).

Grammar note for those last two: **numerals** (一, 百…) are a noun subclass (数詞)
but keep `type: numeral`; **counters** (本, 枚…) are technically suffixes (助数詞)
but keep `type: counter`. The counter decks are one file per counter (`hon.tsv`,
`nin.tsv`…), each 1–N with irregular readings spelled out — generated by
`tools/generate-counters.mjs` (safe to re-run; it only writes `data/counter/*.tsv`).
Edit readings in that script and re-run, not the TSVs by hand.

## After any change

Run the bundler and sanity-check the affected decks:

```bash
node tools/bundle-data.mjs
```
