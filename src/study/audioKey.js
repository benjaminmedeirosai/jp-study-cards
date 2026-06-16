// Shared, dependency-free key logic for offline audio clips — imported by BOTH
// the browser app and the Node generator (tools/audio/gen-audio.mjs) so the two
// sides can never disagree on a clip's filename or spoken text.
//
// Layout mirrors data/: a clip lives at  audio/<lang>/<deckId>/<slug>.m4a , the
// 1-1 mirror of  data/<lang>/<deckId>.tsv . The generator writes that path; the
// app, on import, reads the same path out of the zip and maps it back to a card.
//
// These take a plain entry object + its library config (no app state), so they
// run identically under Node and the browser.

// lowercase, fold accents to ASCII (í→i, ñ→n), spaces → hyphens, drop anything
// that isn't alnum/-/_ (mirrors the shell slugify in the TTS helper, so
// filenames match across tools). Folding (not dropping) accents is what keeps
// distinct accented words distinct: without it "allí" and "allá" both collapse
// to "all" and share — or clobber — one clip.
export function slugify(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "");
}

// Small, sync, dependency-free 53-bit hash (cyrb53) — identical under Node and
// the browser. Used to slug entries whose fields aren't ASCII-uniquely
// sluggable (Japanese: kanji/kana slugify to ""; the English fallback collides
// for synonyms like 塩辛い/しょっぱい → "salty"). Hashing the card identity gives
// a stable, collision-resistant ASCII filename instead.
export function cyrb53(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

// The card-identity string for a library's field mapping (primary|reading|
// translation), mirroring shared.js entryKey / audioStore.entryKeyFor.
function entryIdentity(entry, lib) {
  const f = lib.fields || {};
  const t = (key) => (key ? String(entry?.[key] ?? "").trim() : "");
  return [t(f.primary), t(f.reading), t(f.translation)].join("|");
}

// Does this library hold one clip PER sound source (so a single card can store
// e.g. a kanji-spoken and a hiragana-spoken clip side by side)? True only when
// it declares more than one source.
export function audioMultiSource(lib) {
  return (lib.soundSources || []).length > 1;
}

// The clip-key/filename source segment for a chosen sound-source value: the
// value itself for multi-source libraries, else "" (single-source libs keep
// their original sourceless keys/filenames untouched).
export function audioClipSource(lib, sourceValue) {
  return audioMultiSource(lib) ? String(sourceValue || "") : "";
}

// The filename stem for a clip (no extension), unique per entry within a deck.
// Order of preference:
//   1. the library's `orderBy` index (Farsi alphabet/harakat → "01".."34")
//   2. the library's explicit `audioSlugField` (e.g. Farsi words → romanization)
//   3. the primary field (Latin-script words like Spanish "rojo")
//   4. the translation, as a last resort when primary isn't ASCII
// NOT the `type` field — it's a category (part-of-speech), not unique.
export function audioSlug(entry, lib) {
  const orderBy = lib.orderBy;
  const orderVal = orderBy ? String(entry?.[orderBy] ?? "").trim() : "";
  if (orderVal && /^\d+$/.test(orderVal)) return orderVal.padStart(2, "0");
  // "hash" mode: no ASCII field is uniquely sluggable (Japanese). Use a stable
  // hash of the card identity so synonyms never collide on the same filename.
  if (lib.audioSlugMode === "hash") return cyrb53(entryIdentity(entry, lib)).toString(36);
  const f = lib.fields || {};
  const slugField = lib.audioSlugField || f.primary;
  return slugify(entry?.[slugField]) || slugify(entry?.[f.translation]);
}

// The text fed to `say` for a clip — mirrors cardPage's studySpeechText for the
// default source: the first non-empty key of the first declared sound source
// (Farsi alphabet → name_fa), else the primary/reading/translation field.
export function audioText(entry, lib) {
  const source = (lib.soundSources || [])[0];
  if (source) {
    const t = audioTextForSource(entry, lib, source.value);
    if (t) return t;
  }
  const f = lib.fields || {};
  return [f.primary, f.reading, f.translation]
    .map((key) => key && String(entry?.[key] ?? "").trim())
    .find(Boolean) || "";
}

// The spoken text for a SPECIFIC sound source (by its value) — the first
// non-empty key it declares. Used by the generator to synthesize one clip per
// source on multi-source libraries (Japanese words: kanji form + hiragana).
export function audioTextForSource(entry, lib, sourceValue) {
  const source = (lib.soundSources || []).find((s) => s.value === sourceValue);
  if (!source) return "";
  for (const key of source.keys) {
    const value = String(entry?.[key] ?? "").trim();
    if (value) return value;
  }
  return "";
}
