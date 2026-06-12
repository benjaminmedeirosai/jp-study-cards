# Japanese data conventions

Rules for editing the Japanese study-card data under `data/japanese/`. Read this
before adding, reorganizing, or reclassifying decks. (Each language is its own
tree under `data/<lang>/` with its own bundle; see `data/AGENTS.md`.)

## Pipeline (how data flows)

```
data/japanese/<…folders…>/<deck>.tsv   ← the ONLY source of truth (folders + names)
        │  node tools/bundle-data.mjs japanese   (walks the tree, derives everything)
        ▼
   data/japanese/cards.json                ← built runtime artifact (app fetches this once)
```

- **There is no manifest.** `bundle-data.mjs` walks `data/japanese/` and derives each
  deck's `id`, `category`, `label`, and `count` from its location and name
  (see [Folder layout](#folder-layout)). To add a deck, drop a `.tsv` in the
  right folder; to recategorize, move/rename it. Then run the bundler.
- `data/japanese/cards.json` is **generated** — never hand-edit it.
- The app builds its category tree purely from the `category` strings in
  `cards.json` (`src/study/shared.js`); it never sees the folder layout. Because
  the bundler derives `category` *from* the folders, the two can't drift.

## File format

New decks are **TSV** (tab-separated). Header is required and must start with
exactly these four columns:

```
kanji	hiragana	type	english
```

An optional **fifth `breakdown` column** carries the kanji gloss (see
[Kanji gloss](#kanji-gloss-breakdown-column)). Add it to the header only when the
deck uses it:

```
kanji	hiragana	type	english	breakdown
変化	へんか	noun	change	[変: change | 化: transform]
```

- One entry per line, tab-separated, four columns (or five with `breakdown`).
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

### Label override (`# label:`)

The deck's display name defaults to its title-cased filename
(`meat-seafood.tsv` → "Meat Seafood"). When the real label needs characters a
filename can't hold — symbols, kanji, ampersands — give it a `# label:` line in
the header and the bundler uses that verbatim instead:

```
# label: 〜本 (long objects)
# The 〜本 counter, 1–20 with the geminating/rendaku readings.
kanji	hiragana	type	english
一本	いっぽん	counter	one (long cylindrical object)
```

## Folder layout

**The folder path IS the category, and the filename IS the label.** The bundler
title-cases each folder segment (splitting on `-`) and joins them with ` / `:

```
data/japanese/words/adjectives/na-adjectives/qualities.tsv
     └─────────────── category ──────────────┘ └ label
  → category "Words / Adjectives / Na Adjectives", label "Qualities", id
    "words/adjectives/na-adjectives/qualities"
```

- **Two top-level trees.** All vocabulary decks live under `data/japanese/words/`
  (category root "Words"); reading passages live under `data/japanese/texts/` (see
  [Reading texts](#reading-texts)). Everything below is about the `words/` tree
  unless noted.
- Mirror the category you want in the app right in the folder tree. The current
  `words/` top groups: `adjectives/{i-adjectives,na-adjectives}/`, `adverbs/`,
  `expressions/`, `grammar/` (+ `grammar/morphemes/`), `nouns/<group>/`,
  `numbers/` (+ `numbers/counters/`), `proper-nouns/<places|world|names|media|
  mythology>/`, `verbs/<godan|ichidan|irregular>/`.
- **Nouns are organized into 7 meaning groups** (was ~23 flat domains):
  `world` (animals, nature), `people` (people files + `body/`, `health/`),
  `society` (business, education, communication, language, media), `places`
  (places files + `position/`, `transportation/`), `things` (objects, clothing,
  food, technology, colors), `abstract` (`concepts/` folder split into themed
  subfiles + emotions, logic, mind, measurement, inquiry, conflict, society,
  loanwords, `time/`), and `culture` (mythology, gaming, name-roots). Eponymous
  groups (people, places) keep their files at the group root to avoid
  "People / People" doubling; others nest one level deeper.
- A deck sitting directly in a top folder (e.g. `numbers/digits.tsv`,
  `grammar/sentence-patterns.tsv`) gets a single-segment category ("Numbers",
  "Grammar"). Nest it one level deeper to make a subcategory.
- Group by meaning, not by arbitrary 50-card chunks (`common-1`, `common-2`…).
- Folder/file names are lowercase-kebab. Use `# label:` (above) when the display
  name needs more than the filename can carry. **No counts anywhere** — they're
  derived from the rows at build time.

## Reading texts

A **reading text** is a short passage you study as a unit: learn its words as
flashcards, then try to read the sentences with the blob as reference. Each one
is a folder under `data/japanese/texts/<slug>/` with exactly three files:

```
data/japanese/texts/intro-japan/
  blob.txt        ← the passage, one paragraph of raw Japanese (reference only)
  sentences.tsv   ← the blob split into sentences  (japanese / english)
  words.tsv       ← every distinct word from the sentences (a normal deck)
```

- **`blob.txt`** — the whole passage as plain text (no header). Reference only;
  the bundler stores it trimmed.
- **`sentences.tsv`** — one row per sentence, in blob order. Header is
  `japanese<TAB>english` (NOT the deck header). `# label:` and `#` comments work
  like any deck; the `# label:` here names the whole text set. `japanese` is the
  sentence exactly as in the blob; `english` is the translation.
- **`words.tsv`** — an ordinary deck (standard `kanji/hiragana/type/english
  [breakdown]` header, gloss + comment-header rules all apply). It still appears
  in `decks` and is studyable in the normal card UI. List every distinct word
  **in the exact surface form it appears** in the sentences — conjugated/derived
  forms (あり, あります, できます, 深く) are their own entries — deduped, in blob
  order. **Omit bare case/binding particles** (は・が・を・に・へ・で・と・も・の・
  や・か and the attributive な) — single-kana glue is noise. **Keep** meaningful
  multi-token grammar and copula/auxiliary forms (ように, でしょう, として,
  といった, という, です) and the contentful particles (など, でも, より).

The bundler folds `blob.txt` + `sentences.tsv` into a separate **`texts`** array
in `cards.json` (one entry per folder: `{id, label, category:"Texts", blob,
sentences, wordsDeckId}`), while `words.tsv` flows through as a normal deck whose
id is referenced by `wordsDeckId`. Add a passage by dropping a new
`data/japanese/texts/<slug>/` folder with these three files and rebuilding. The reading
view that consumes the `texts` array is not built yet — this is the data layer.

## Kanji decks (`kanji/` — per-character study)

Single-character kanji study lives in its own subtree, `data/japanese/kanji/`,
with **different columns** from the word decks. The bundler detects the
`kanji/` path (`SCHEMAS.japanese.subschemas` in `tools/bundle-data.mjs`), parses
these columns, and stamps each deck with `kind: "kanji"` so the app renders the
kanji card layout (readings split into on/kun lines; radical + components in the
top-right tap-menu) instead of the word layout.

### Columns

```
kanji  onyomi  kunyomi  meaning  radical  radical-name  components  [strokes]  [grade]
水	スイ	みず	water	水	みず		4	1
校	コウ		school; proof	木	きへん	木、交	10	2
```

- **kanji** — the single character. One per row.
- **onyomi** — on readings in **katakana**, `、`-separated (`ボク、モク`). Blank if none.
- **kunyomi** — kun readings in **hiragana**, `、`-separated, with the okurigana
  in parens (`やす(む)` = the kanji covers やす, む is okurigana). This is the
  literal display form; TTS strips the parens to speak it. Blank if none.
- **meaning** — English keyword(s), `;`-separated.
- **radical** — the single classifying radical (部首) as its **combining-form
  glyph** (`亻`, `氵`, `木`).
- **radical-name** — its Japanese name (`にんべん`, `さんずい`, `きへん`).
- **components** — the one-level decomposition into recognizable parts,
  `、`-separated (`校` → `木、交`). Blank when the kanji is itself a primitive
  with no further parts (`水`, `人`). The radical usually appears here too.
- **strokes**, **grade** — optional trailing columns (画数; 教育漢字 grade 1–6).
  `jlpt` is NOT a column — the level is encoded by the `n5/`…`n1/` folder.

These two readings deliberately break the word decks' all-hiragana rule (§
Classification principle 5): for kanji study the on=katakana / kun=hiragana
split is the point.

### Folder layout

`kanji/<jlpt-level>/<theme>.tsv` — JLPT level first, then theme files mirroring
the meaning groups used elsewhere (`n5/numbers.tsv`, `n5/nature.tsv`,
`n5/people-body.tsv`, `n5/position.tsv`). For N1 (~1000+, where rarer kanji are
domain-specific) add domain subfolders (`n1/law/`, `n1/medicine/`, …). Category
comes out as "Kanji / N5", label from the filename, same as any deck.

**Level = JLPT, not school grade.** The folder is the kanji's JLPT level, which
does **not** align with the 教育漢字 grade in the `grade` column (JLPT N2 spans
grades 3–6 + secondary). `n2/` is the canonical JLPT N2 set (380 kanji, the
jlptsensei list). `n5/`/`n4/`/`n3/` were originally bucketed by school grade and
are **not yet realigned** to canonical JLPT lists — when realigning a level,
diff its canonical list against the whole tree and relocate, don't re-grade.
`n3/extra-f.tsv` parks grade-4 kanji displaced from `n2/` during the N2 fix.

### Building it out — the coverage audit

`tools/japanese/kanji-coverage.mjs` reads the built bundle and reports which
kanji are **used** (in any word deck's `kanji` field or any text sentence) but
not yet **covered** by a `kanji/` deck row:

```bash
node tools/bundle-data.mjs japanese && node tools/japanese/kanji-coverage.mjs
```

It writes `tmp/kanji-uncovered.json` — `[{ kanji, used, sampleWords,
sampleSentences }]` sorted most-used first, so the top of the list is the
highest-priority kanji to add next.

## Kanji gloss (`breakdown` column)

The optional 5th column gives a per-kanji gloss so a learner can see what each
character contributes to the word. Format is a bracketed, ` | `-separated list,
one element per **kanji**, each `漢: meaning/contribution`:

```
順番	じゅんばん	noun	order; sequence	[順: order/sequence | 番: number/turn]
歪み	ゆがみ	noun	distortion; warp	[歪: distort/warp]
```

- **Only kanji are glossed.** Okurigana and kana are skipped — `歪み` glosses just
  `歪`; `真っ赤` glosses `真` and `赤`, not the っ. A mixed kanji+kana/katakana word
  glosses only its kanji (`毒ガス` → `[毒: poison]`).
- The bundler carries `breakdown` only when the header declares it **and** the
  cell is non-empty, so leaving a row's gloss blank keeps `cards.json` lean.

### When to gloss vs. skip

Gloss it when the breakdown teaches something:

- **Multi-kanji compounds** — always (変化, 順番, 太平洋…).
- **Single kanji written with okurigana** — yes, because the okurigana obscures
  the kanji (繋がり → `[繋: connect/tie]`, 願い → `[願: wish/request]`).
- **Name/place kanji** — yes; gloss meanings (etymological for surnames), and
  gloss the geography suffixes 市/県/区/駅/町/村 (新宿駅 → `…| 駅: station`).
- **〜的** → `的: -ic/-al/-ive`.

Skip it (leave the cell blank) when a gloss adds nothing:

- **Single-kanji entries whose gloss equals the English** (水, 山, 本, 音, 謎, 命,
  旅, 質…). The card already shows the meaning.
- **Pure kana / katakana** entries and whole kana/katakana files (loanwords,
  onomatopoeia, `*-kana.tsv`, core-kana) — nothing to break down.
- **Counters and numerals** — the reading drill is the point, not the kanji.
- **Morpheme decks** (prefixes/suffixes/particles) — the English already *is* the
  per-morpheme gloss.
- **Iteration mark** 々 is not a kanji — don't gloss it.

### Validating a gloss pass

`tools/japanese/check-gloss.mjs` reads `cards.json` and, for the deck ids matching a
prefix, asserts every gloss segment is `漢: …` where 漢 is a single Han character
actually present in the word, the value is bracketed, and contains a colon. Run
the bundler first (the validator reads the built artifact):

```bash
node tools/bundle-data.mjs japanese && node tools/japanese/check-gloss.mjs words/nouns/abstract/concepts
```

It prints `glossed/total` per deck and a mismatch count — aim for **0
mismatches** (the glossed<total gap is just the intentional skips above). When
rewriting large files by hand, also diff entry signatures
(`kanji\thiragana\tenglish`, sorted) against the pre-edit baseline to prove no
rows were dropped — hand-rewrites are the main way rows go missing.

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
8. **Place the new decks** in folders that spell out the category you want
   (e.g. `data/japanese/words/adjectives/na-adjectives/`); add a `# label:` line where the
   display name needs symbols/kanji.
9. **Delete the old files** and run the bundler — the tree is the manifest.

Done so far: `na-adjective`, `morpheme`, `i-adjective`, `numeral`, `counter`,
`proper-nouns`, `nouns` (full — all common-N.json classified into ~24 domains),
`verbs`, `adverb`, `particle`, `conjunction`, `expression`. **All legacy
`common-N.json` decks are migrated — `data/` is TSV-only.**

Grammar note for numeral/counter: **numerals** (一, 百…) are a noun subclass (数詞)
but keep `type: numeral`; **counters** (本, 枚…) are technically suffixes (助数詞)
but keep `type: counter`. The counter decks are one file per counter (`hon.tsv`,
`nin.tsv`…), each 1–N with irregular readings spelled out (一本 いっぽん, 二十歳
はたち…) — edit the TSVs directly like any other deck.

### Verbs — grouped by conjugation class, not meaning

Verbs keep their grammatical structure rather than being re-themed: godan split
one file per dictionary ending (`godan/u.tsv`, `ku.tsv`…`ru.tsv`); ichidan can't
split by ending (all end in る), so it splits by structure: `ichidan/compound.tsv`
(verb+verb / noun+verb 引き受ける/目覚める), and single-stem verbs further by
transitivity then theme — `ichidan/transitive/{handling,mind}.tsv` and
`ichidan/intransitive/{motion,change,experience}.tsv`. The two true irregulars
are in `irregular/irregular.tsv` (する/来る); 名詞+する compounds inherit する's
conjugation and live in `irregular/suru-verbs.tsv`.
**Vocab decks hold dictionary forms only.** The source `common-N`/`*-ending`
JSON was riddled with conjugation drills (行かない, 行った, 行こう, 行ける, 行かせる…);
those were stripped. Surface form can't tell a volitional 行こう from the verb 思う,
so the reliable filter is the **english gloss**: dictionary entries read `to …`;
conjugations read `let's…/can…/be…/make-let…` and were dropped (keep the humble
verbs 差し上げる/申し上げる and できる, which are real lexical items).

### Conjugation & pattern decks live in `grammar/`

Inflection paradigms are taught as the **transformation rule**, not a per-word
drill. Verb conjugation is sliced **by form** under `grammar/conjugation/verb/`
— one deck per form (`past.tsv`, `te-form.tsv`, `negative.tsv`,
`potential-passive.tsv`, `causative.tsv`…), each showing the same form across
verb classes (godan covering every dictionary ending う/く/ぐ/す/つ/ぬ/ぶ/む/る,
ichidan, and the irregulars する/来る). Add a verb root to broaden a form deck;
generate the conjugations by rule (euphonic 音便 tables) rather than hand-typing.
Adjective paradigms stay as single decks alongside it:
`grammar/conjugation/i-adjective.tsv` (高い…) and
`grammar/conjugation/na-adjective.tsv` (便利).

Productive bound grammar lives under `grammar/patterns/` with a `〜` placeholder
(not the old `Vたら`/`ブイたら` notation): the **te-form family** (〜ている, 〜ておく,
〜てみる, 〜てくれる, 〜てもいい…) in `patterns/te-form.tsv`; all other bound patterns
(〜たい, 〜べき, 〜のに, 〜はず, modality 〜らしい/〜ようだ…) and core function words
(だ, 〜という) in `patterns/sentence-patterns.tsv`; the 〜そう appearance forms in
`patterns/appearance-sou.tsv` and 〜やすい/〜にくい/〜っぽい in
`patterns/derived-i-adjective.tsv`. Particles, conjunctions, and `morphemes/`
stay at the `grammar/` root. Onomatopoeia (擬音語/擬態語) consolidated into
`adverb/onomatopoeia.tsv` (katakana, same form in both columns). The
`descriptive-phrase` and `phrase-sentence` folders were dissolved — they were
mostly number+counter combos (redundant with the counter decks) and a few set
phrases that moved to `expression/idioms.tsv`.

## Coverage audit (filling kanji gaps)

Once decks are migrated, the ongoing work is **broadening kanji coverage** so
each character shows up in enough distinct words to be learnable. The tools:

```bash
node tools/japanese/audit-data.mjs        # reads every deck, writes 3 reports to tmp/
node tools/japanese/polysemy-audit.mjs    # checks high-value multi-sense/POS words are
                                 # represented across the decks they should span
node tools/japanese/check-gloss.mjs       # validates breakdown glosses (see below)
```

`audit-data` and `polysemy-audit` **exclude the `texts/` tree** — reading-text
word lists are surface-form aids that repeat common words across passages, so
they'd pollute the coverage and duplicate reports. They reason about the
`words/` tree only. (`check-gloss` still validates `texts/` glosses — pass a
`texts/` prefix to scope it there.)

**Scripts vs. outputs convention.** Permanent, committed tooling lives in
`tools/` (the bundler, the audits, the gloss validator, the dev server).
Everything under `tmp/` is gitignored: throwaway one-off dev scripts (a
`wave.mjs`, a `split-*.mjs`) go in **`tmp/tools/`**, and their generated reports
land in **`tmp/` itself**. The reports are dev-reference artifacts, never
committed and never consumed by the app:

- **`tmp/kanji-coverage-1.json`** — kanji appearing in exactly **1** distinct word.
- **`tmp/kanji-coverage-2.json`** — kanji appearing in exactly **2** distinct words.
- **`tmp/duplicates.json`** — word forms (kanji+reading) that occur in 2+ places.
  Each entry lists every occurrence (file, deck, type, english). **Dups are
  tolerated** — they're intentional dual-POS words (健康 noun + na-adjective),
  surnames that double as nouns (森), or conjugation-example restatements
  (できる). This report is just visibility, not a to-do list.

### The goal: a 3-distinct-word floor per kanji

Each kanji should appear in **at least 3 distinct words** across the data, so
`kanji-coverage-1`/`-2` are the worklist. Lift them by adding common vocabulary.

### The wave process (how we actually do it, with the user)

This is iterative and **reviewed one wave at a time** — do not batch silently:

1. **Pick a chunk** (~40–48) off the top of `kanji-coverage-1.json`, skipping
   known dead-ends (see below).
2. **Choose words by depth, common-first.** For each kanji, pick genuinely
   common vocab — **N4 → N3 → N2 priority**. Only reach into rarer/N1 words when
   a kanji can't otherwise clear 3. A shared compound counts for both its kanji
   (姉妹 lifts both 姉 and 妹), so add it once.
3. **Slot into existing themed decks** (reuse categories; match each word's
   meaning to a deck per the classification principles above). Verbs go to the
   conjugation-class deck for their dictionary ending; pick the right `type`.
4. **Apply via a throwaway `tmp/tools/wave.mjs`**: an array of
   `[deckId, kanji, hiragana, type, english]`, which dedups every form against
   all existing entries (skip collisions), groups by file, and appends. This
   keeps readings/placement reviewable in one place and prevents duplicates.
5. **Rebuild + re-audit**: `node tools/bundle-data.mjs japanese && node tools/japanese/audit-data.mjs`.
   Confirm the singleton count dropped and no *new* duplicates appeared. Adding
   compounds introduces their own rarer kanji, so the singleton count falls by
   less than the chunk size — that cascade is expected; later waves catch them.
6. **Present the wave for review** (kanji → words → deck), flag judgment calls,
   and **pause**. Commit every couple of approved waves.

### Dead-ends — leave at 1–2, don't pad

Some kanji genuinely have no common 3rd word. **Do not force them to 3** with
obscure compounds — leave them and move on. The irreducible tail is:

- **Given-name kanji** (亮, 悠, 拓, 樹 when only a name) and **place-only kanji**
  (埼, 媛, 栃, 幌).
- **Pronouns / single-word items** that *are* the whole word (俺, 僕, 奴).
- **Bound kanji** that occur in only one common compound (曖/昧 → 曖昧, 椅 →
  椅子, 梯 → 梯子, 拶/挨 → 挨拶, 戚 → 親戚, 嫉 → 嫉妬).
- **Usually-kana words** (梟=フクロウ, 凧, 嬉しい's 嬉).

## After any change

Run the bundler and sanity-check the affected decks:

```bash
node tools/bundle-data.mjs japanese
```
