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

// lowercase, spaces → hyphens, drop anything that isn't alnum/-/_ (mirrors the
// shell slugify in the TTS helper, so filenames match across tools).
export function slugify(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "");
}

// The filename stem for a clip (no extension). Prefer the library's canonical
// `orderBy` index (Farsi alphabet/harakat → "01".."34"), else a slug of the
// romanization/translation/primary field — whichever ASCII value exists first.
export function audioSlug(entry, lib) {
  const orderBy = lib.orderBy;
  const orderVal = orderBy ? String(entry?.[orderBy] ?? "").trim() : "";
  if (orderVal && /^\d+$/.test(orderVal)) return orderVal.padStart(2, "0");
  const f = lib.fields || {};
  const candidate = [f.type, f.translation, f.primary]
    .map((key) => key && String(entry?.[key] ?? "").trim())
    .find(Boolean) || "";
  return slugify(candidate);
}

// The text fed to `say` for a clip — mirrors cardPage's studySpeechText for the
// default source: the first non-empty key of the first declared sound source
// (Farsi alphabet → name_fa), else the primary/reading/translation field.
export function audioText(entry, lib) {
  const source = (lib.soundSources || [])[0];
  if (source) {
    for (const key of source.keys) {
      const value = String(entry?.[key] ?? "").trim();
      if (value) return value;
    }
  }
  const f = lib.fields || {};
  return [f.primary, f.reading, f.translation]
    .map((key) => key && String(entry?.[key] ?? "").trim())
    .find(Boolean) || "";
}
