// Library registry — each "library" is a language/dictionary the app can study.
// One codebase, namespaced by library: the shell (study loop, deck tree, sets,
// settings) is shared; per-library config below describes what's different.
//
// A library declares:
//   • data        — the bundle to fetch (data/<lang>/cards.json)
//   • tts.lang     — speech-synthesis language tag
//   • fields       — maps the card's logical slots to entry property names; a
//                    null slot means the language has no such field (e.g. Spanish
//                    has no `reading`/`gloss`). Field-mapping accessors in
//                    shared.js read this so the rest of the app stays generic.
//   • modeIds      — which MODES (shared.js) this library offers, in order
//   • groupingIds  — which SET_GROUPINGS (shared.js) this library offers
//   • features     — UI capability flags (sound-source toggle, gloss, texts)
//
// Japanese is the baseline; only seams Spanish actually needs are abstracted —
// per-language divergence is expected to grow, so add config here, not forks.

// A "language" groups the schemas you can study it under. The 🌐 picker selects
// a language; each language owns one or more schemas (entries in LIBRARIES that
// share its `language` id). This scales: a new schema for a language (a Kana
// schema for Japanese, say) is one more LIBRARIES entry, not a new top-level
// picker item.
export const LANGUAGES = [
  { id: "japanese", label: "Japanese", short: "日本語" },
  { id: "spanish", label: "Spanish", short: "ES" },
  { id: "farsi", label: "Farsi", short: "فا" }
];

// Each entry is a SCHEMA — the unit of independent state/modes/settings/card.
// `language` groups it under a LANGUAGES entry; `schemaLabel` names it within
// that language ("Words", "Kanji"). The default schema for a language is its
// first entry here.
export const LIBRARIES = [
  {
    id: "japanese",
    label: "Japanese",
    short: "日本語",
    language: "japanese",
    schemaLabel: "Words",
    data: "data/japanese/cards.json",
    // The Japanese bundle holds both word decks and kanji decks; this library is
    // the WORD schema, so it only shows decks of kind "word" (see listDecks).
    deckKind: "word",
    // `estimate` drives the autoplay TTS-duration guess: count chars of `source`
    // (reading morae for Japanese) × `msPerUnit`.
    tts: { lang: "ja-JP", estimate: { source: "reading", msPerUnit: 200 } },
    voiceSample: "こんにちは。これは音声のプレビューです。",
    fields: { primary: "kanji", reading: "hiragana", translation: "english", type: "type", gloss: "breakdown" },
    // Nouns for the settings font controls, per logical slot.
    labels: { primary: "Kanji", reading: "Hiragana", gloss: "Kanji gloss" },
    modeIds: ["kanji", "english", "hiragana", "voice", "show-all"],
    groupingIds: [
      "kanji-alpha", "hiragana-alpha",
      "kanji-likeness-slotting", "kanji-likeness-grouping",
      "hiragana-likeness-slotting", "hiragana-likeness-grouping",
      "file-order"
    ],
    // The sound-source picker options (value + button label + the entry fields
    // its speech reads). Word study: speak the kanji word or its kana reading.
    // scope "card": a per-card choice on the tray (TTS mis-reads some words'
    // counters, so the source is overridable per word).
    soundSourceScope: "card",
    soundSources: [
      { value: "kanji", label: "Kanji", keys: ["kanji"] },
      { value: "hiragana", label: "Hiragana", keys: ["hiragana"] }
    ],
    features: { soundSource: true, gloss: true, texts: true }
  },
  {
    // Per-character kanji study — its own schema/library so its modes, settings,
    // fonts, voice and sound-source choice are independent of the word decks
    // (same per-library state split as Spanish). Shares the Japanese bundle but
    // shows only kind:"kanji" decks. The card layout is rendered specially
    // (on/kun reading lines; radical + components in the tap-menu area).
    id: "japanese-kanji",
    label: "Japanese Kanji",
    short: "漢字",
    language: "japanese",
    schemaLabel: "Kanji",
    data: "data/japanese/cards.json",
    deckKind: "kanji",
    tts: { lang: "ja-JP", estimate: { source: "primary", msPerUnit: 200 } },
    voiceSample: "こんにちは。これは音声のプレビューです。",
    // reading→onyomi is nominal (for entryKey/estimate); the card renders both
    // onyomi and kunyomi. type/gloss have no kanji equivalent.
    fields: { primary: "kanji", reading: "onyomi", translation: "meaning", type: null, gloss: null },
    labels: { primary: "Kanji", reading: "Reading" },
    modeIds: ["kanji", "meaning", "reading", "show-all"],
    groupingIds: ["kanji-alpha", "file-order"],
    // Sound source: on'yomi, kun'yomi, or both (speaks 音 then 訓). scope
    // "library": a single standing preference (lives in Settings), not a per-card
    // choice — which reading to voice isn't something you'd set per kanji.
    soundSourceScope: "library",
    soundSources: [
      { value: "onyomi", label: "On'yomi", keys: ["onyomi"] },
      { value: "kunyomi", label: "Kun'yomi", keys: ["kunyomi"] },
      { value: "both", label: "Both", keys: ["onyomi", "kunyomi"] }
    ],
    // Filtering by a radical or component matches any kanji whose radical or
    // components contain it, so the tap-menu filter works on these fields too.
    searchKeys: ["kanji", "onyomi", "kunyomi", "meaning", "radical", "radical-name", "components"],
    // multiReading: the readings are 、-separated lists, so the "read all
    // readings vs just the first" voice toggle is meaningful here.
    features: { soundSource: true, gloss: false, texts: false, multiReading: true }
  },
  {
    id: "spanish",
    label: "Spanish",
    short: "ES",
    language: "spanish",
    schemaLabel: "Words",
    data: "data/spanish/cards.json",
    deckKind: "word",
    // Latin words run faster per character than Japanese morae.
    tts: { lang: "es-US", estimate: { source: "primary", msPerUnit: 75 } },
    voiceSample: "Hola. Esta es una vista previa de la voz.",
    fields: { primary: "spanish", reading: null, translation: "english", type: "type", gloss: null },
    labels: { primary: "Word" },
    // Latin-script languages don't need the CJK font catalogue — just a couple
    // of generic system faces. (Omit `fontIds` to offer the full list, as
    // Japanese does.)
    fontIds: ["default", "sys-sans", "sys-serif"],
    modeIds: ["spanish", "english", "voice", "show-all"],
    groupingIds: ["primary-alpha", "english-alpha", "primary-likeness-slotting", "primary-likeness-grouping", "file-order"],
    features: { soundSource: false, gloss: false, texts: false }
  },
  {
    // Farsi (Persian) words. RTL script — `rtl: true` flips the card text slots.
    // The card render shows four rows (word / vocalized / romanization / meaning);
    // vocalized is the harakat-marked form, shown at full emphasis (a distinct
    // concept, not a dimmed reading) AND fed to TTS (falling back to the bare word
    // for audio only — display stays blank when vocalized is empty).
    id: "farsi",
    label: "Farsi",
    short: "فا",
    language: "farsi",
    schemaLabel: "Words",
    data: "data/farsi/cards.json",
    deckKind: "word",
    rtl: true,
    tts: { lang: "fa-IR", estimate: { source: "primary", msPerUnit: 90 } },
    voiceSample: "سلام. این یک پیش‌نمایش صدا است.",
    fields: { primary: "word", reading: "vocalized", translation: "meaning", type: "label", gloss: null },
    labels: { primary: "Word", reading: "Vocalized" },
    fontIds: ["default", "sys-sans", "sys-serif"],
    modeIds: ["word", "english", "voice", "show-all"],
    groupingIds: ["farsi-word-alpha", "english-alpha", "file-order"],
    // Single sound source (Settings, not per-card): speak the vocalized form,
    // falling back to the bare word when it has no harakat marks.
    soundSourceScope: "library",
    soundSources: [{ value: "word", label: "Word", keys: ["vocalized", "word"] }],
    searchKeys: ["word", "vocalized", "label", "meaning"],
    features: { soundSource: false, gloss: false, texts: false }
  },
  {
    // Farsi alphabet — its own schema. The card shows the letter big, its name
    // (romanized + Persian), and a four-cell forms table (isolated/initial/medial/
    // final) rendered specially. TTS speaks the Persian letter name (name_fa).
    id: "farsi-alpha",
    label: "Farsi Alphabet",
    short: "ا ب پ",
    language: "farsi",
    schemaLabel: "Alphabet",
    data: "data/farsi/cards.json",
    deckKind: "alpha",
    rtl: true,
    tts: { lang: "fa-IR", estimate: { source: "reading", msPerUnit: 300 } },
    voiceSample: "الف، بِ، پِ.",
    fields: { primary: "isolated", reading: "name_fa", translation: "name", type: "index", gloss: null },
    // Navigate in canonical alphabet order (the `index` column), not by glyph
    // collation — otherwise ء (hamze) sorts to the front despite being last.
    orderBy: "index",
    // Font-control labels map the four size slots onto the alphabet's elements:
    // primary→isolated letter, reading→Farsi name, translation→English name,
    // gloss→the positional forms.
    labels: { primary: "Isolated", reading: "Farsi name", translation: "English name", gloss: "Other forms" },
    fontIds: ["default", "sys-sans", "sys-serif"],
    modeIds: ["letter", "name-fa", "name-en", "initial", "medial", "final", "voice", "show-all"],
    groupingIds: ["file-order"],
    soundSourceScope: "library",
    soundSources: [{ value: "name", label: "Name", keys: ["name_fa"] }],
    searchKeys: ["isolated", "name", "name_fa", "initial", "medial", "final"],
    // formsTable: render the positional-forms table (the alphabet's analogue of
    // the kanji breakdown area).
    features: { soundSource: false, gloss: false, texts: false, formsTable: true }
  },
  {
    // Farsi harakat (diacritical marks) — third schema. The card shows the mark
    // on a carrier, its name + effect, and a row of usage examples (the mark in
    // use, with romanization). TTS speaks the mark's Persian name (name_fa).
    id: "farsi-harakat",
    label: "Farsi Harakat",
    short: "ـَ ـِ ـُ",
    language: "farsi",
    schemaLabel: "Harakat",
    data: "data/farsi/cards.json",
    deckKind: "harakat",
    rtl: true,
    tts: { lang: "fa-IR", estimate: { source: "reading", msPerUnit: 300 } },
    voiceSample: "زَبَر، زیر، پیش.",
    fields: { primary: "mark", reading: "name_fa", translation: "name", type: "effect", gloss: null },
    // Navigate in canonical order (the `index` column), not by glyph collation.
    orderBy: "index",
    // Font-size slots: primary→mark, reading→Farsi name, translation→English
    // name, gloss→the example glyphs.
    labels: { primary: "Mark", reading: "Farsi name", translation: "English name", gloss: "Examples" },
    fontIds: ["default", "sys-sans", "sys-serif"],
    modeIds: ["mark", "name-fa", "name-en", "effect", "voice", "show-all"],
    groupingIds: ["file-order"],
    soundSourceScope: "library",
    soundSources: [{ value: "name", label: "Name", keys: ["name_fa"] }],
    searchKeys: ["mark", "name", "name_fa", "effect", "ex1", "ex1_rom", "ex2", "ex2_rom", "ex3", "ex3_rom", "ex4", "ex4_rom"],
    // examplesTable: render the usage-examples card layout.
    features: { soundSource: false, gloss: false, texts: false, examplesTable: true }
  }
];

export const DEFAULT_LIBRARY_ID = "japanese";

export function getLibrary(id) {
  return LIBRARIES.find((library) => library.id === id) || LIBRARIES[0];
}

export function normalizeLibraryId(id) {
  return LIBRARIES.some((library) => library.id === id) ? id : DEFAULT_LIBRARY_ID;
}

export function getLanguage(id) {
  return LANGUAGES.find((language) => language.id === id) || LANGUAGES[0];
}

// The schemas belonging to a language, in registry order (first = default).
export function schemasForLanguage(languageId) {
  return LIBRARIES.filter((library) => library.language === languageId);
}

// Languages with their schemas, in LANGUAGES order — the shape the 🌐 picker
// renders. Drops any language that has no schemas.
export function libraryGroups() {
  return LANGUAGES
    .map((language) => ({ language, schemas: schemasForLanguage(language.id) }))
    .filter((group) => group.schemas.length);
}

// Display caption for a schema: "Japanese · Kanji" when its language has more
// than one schema, else just the language name ("Spanish").
export function schemaCaption(library) {
  const language = getLanguage(library.language);
  const multi = schemasForLanguage(library.language).length > 1;
  return multi ? `${language.label} · ${library.schemaLabel}` : language.label;
}
