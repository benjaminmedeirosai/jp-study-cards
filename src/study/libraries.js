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

export const LIBRARIES = [
  {
    id: "japanese",
    label: "Japanese",
    short: "日本語",
    data: "data/japanese/cards.json",
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
      "hiragana-likeness-slotting", "hiragana-likeness-grouping"
    ],
    features: { soundSource: true, gloss: true, texts: true }
  },
  {
    id: "spanish",
    label: "Spanish",
    short: "ES",
    data: "data/spanish/cards.json",
    // Latin words run faster per character than Japanese morae.
    tts: { lang: "es-ES", estimate: { source: "primary", msPerUnit: 75 } },
    voiceSample: "Hola. Esta es una vista previa de la voz.",
    fields: { primary: "spanish", reading: null, translation: "english", type: "type", gloss: null },
    labels: { primary: "Word" },
    modeIds: ["spanish", "english", "voice"],
    groupingIds: ["primary-alpha", "primary-likeness-slotting", "primary-likeness-grouping"],
    features: { soundSource: false, gloss: false, texts: false }
  }
];

export const DEFAULT_LIBRARY_ID = "japanese";

export function getLibrary(id) {
  return LIBRARIES.find((library) => library.id === id) || LIBRARIES[0];
}

export function normalizeLibraryId(id) {
  return LIBRARIES.some((library) => library.id === id) ? id : DEFAULT_LIBRARY_ID;
}
