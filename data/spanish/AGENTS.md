# Spanish data conventions

Rules for editing the Spanish study-card data under `data/spanish/`. Read this
before adding or reorganizing decks. (Each language is its own tree under
`data/<lang>/` with its own bundle; see `data/AGENTS.md`. The Japanese tree has
its own, fuller conventions in `data/japanese/AGENTS.md`.)

## Pipeline

```
data/spanish/<…folders…>/<deck>.tsv   ← the ONLY source of truth (folders + names)
        │  node tools/bundle-data.mjs spanish   (walks the tree, derives everything)
        ▼
   data/spanish/cards.json                ← built runtime artifact (never hand-edit)
```

There is no manifest: the bundler derives each deck's `id`, `category`, `label`,
and `count` from its folder path and filename (folder path → title-cased
category joined with ` / `; filename → label, overridable with `# label:`).

## File format

TSV, three columns, header required:

```
spanish	type	english
perro	noun	dog
```

- Spanish has **no `reading` and no `gloss`** — the schema is just these three
  columns (`SCHEMAS.spanish` in `tools/bundle-data.mjs`). No `breakdown` column.
- `type` is the part of speech: `noun`, `adjective`, `verb`, `adverb`,
  `pronoun`, `preposition`, `conjunction`, `article`, `number`, `interrogative`,
  `phrase`, `idiom`.
- Start each file with a `#` comment block saying what belongs in it (and note
  the nearest sibling a borderline word might go to instead). `#` lines are
  ignored by the bundler.
- `# label:` overrides the display name when it needs characters a filename
  can't carry (used by the regional decks, e.g. `# label: Idioms (Spain)`).

### Conventions in this data

- **Nouns carry the definite article** to teach gender: `el perro`, `la casa`,
  plural `las gafas` / `los lentes`. Watch the gotchas — `la mano` (f despite
  `-o`), `el agua` (f but takes `el` in the singular for euphony). Two
  exceptions stay bare: **months** (`enero`, never `el enero` — months take no
  article) and **non-nouns** (adjectives, verbs, adverbs…).
- The article is stripped for sorting & letter-likeness in `sets.js`
  (`collationValue`, locale-gated to `es`), so A–Z grouping keys off the noun
  itself (`perro`), not `el`.
- **Verbs are infinitives only** (dictionary form: `hablar`, `comer`). No
  conjugations; conjugation paradigms would be their own `grammar/` decks later,
  the way Japanese keeps them out of the vocab decks.
- **Adjectives in masculine singular** (`rojo`, `bonito`) as the citation form.

## Folder layout (current)

Flat by part of speech — no `words/` wrapper (Spanish has no `texts/` sibling to
disambiguate from, so the extra level would be noise):

```
adjectives/   colors, qualities, size, personality, feelings, quantity
nouns/        people, family, body, animals, food, drinks, fruits-vegetables,
              home, clothing, places, nature, transportation, time/{days,months,units}
verbs/        ar-regular, er-regular, ir-regular, irregular, reflexive
adverbs/      manner, time, place, frequency
grammar/      articles, pronouns, prepositions, conjunctions, question-words
numbers/      cardinal, ordinal
expressions/  greetings, common-phrases, idioms/{general, <region>...}
regional/     <region>.tsv  (vocabulary that diverges by region)
```

## Regional variation

~90% of common Spanish is pan-Hispanic; a minority diverges by country. Two
kinds, both isolated into per-region files so the core stays neutral:

1. **Vocabulary variants** — same concept, different everyday word
   (car: *coche* ES / *carro* LatAm; juice: *zumo* ES / *jugo* LatAm). Core decks
   use the most widely-understood term and stay region-free; the diverging words
   live in `regional/<region>.tsv` (each row that region's preferred term). The
   folder→category gives "Regional / Mexico", so a learner targeting a country
   studies that deck.
2. **Idioms & slang** — region-locked sayings go in
   `expressions/idioms/<region>.tsv`; pan-Hispanic ones in `idioms/general.tsv`.

Duplicates across regional files (carro *and* coche both → "car") are intentional
— the deck/category carries the region. When a core deck omits a word because it
splits regionally, leave a `#` note in that deck pointing to `regional/`.

The `regional/` and `idioms/<region>` files are currently **small samples**
pending review of the approach (and of whether the app should grow a per-region
preference setting rather than just exposing the decks).

## After any change

```
node tools/bundle-data.mjs spanish
```
