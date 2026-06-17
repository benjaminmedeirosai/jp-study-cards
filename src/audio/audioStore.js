// Offline audio clips, stored in IndexedDB and played back instead of the Web
// Speech voice when present. Lets a device with no Farsi (etc.) TTS voice still
// hear pronunciations: generate clips on a Mac (tools/audio/gen-audio.mjs), zip
// them, and import the zip here.
//
// Clips are keyed by `${lang}::${entryKey}` — the card's intrinsic identity, so
// playback looks them up without caring which deck view you're in.

import { LIBRARIES } from "../core/libraries.js";
import { audioSlug, audioMultiSource } from "./audioKey.js";

const DB_NAME = "jp-study-audio";
const STORE = "clips";          // downloadable / imported pack clips (+ the active recording mirror)
const REC_STORE = "recordings"; // user recordings: take blobs + per-card meta (irreplaceable, isolated)
const SEP = "::";

let dbPromise = null;
function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = (event) => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      // v2: recordings get their own store so a pack "Clear all" (which clears
      // the clips store) can never touch irreplaceable user recordings. Migrate
      // any v1 recording keys (`__rec__…` / `__recmeta__…`) out of clips.
      if (!db.objectStoreNames.contains(REC_STORE)) {
        db.createObjectStore(REC_STORE);
        if (event.oldVersion >= 1 && db.objectStoreNames.contains(STORE)) {
          const upgradeTx = event.target.transaction;
          const clips = upgradeTx.objectStore(STORE);
          const recs = upgradeTx.objectStore(REC_STORE);
          clips.openCursor().onsuccess = (e) => {
            const cur = e.target.result;
            if (!cur) return;
            const k = String(cur.key);
            if (k.startsWith("__rec__::") || k.startsWith("__recmeta__::")) {
              recs.put(cur.value, cur.key);
              cur.delete();
            }
            cur.continue();
          };
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(mode) {
  return openDb().then((db) => db.transaction(STORE, mode).objectStore(STORE));
}
function recTx(mode) {
  return openDb().then((db) => db.transaction(REC_STORE, mode).objectStore(REC_STORE));
}
// Inclusive key range covering every key with `${lang}::` prefix (all clips for
// a language). ￿ sorts above any real key char, so it bounds the prefix.
function langRange(lang) {
  return IDBKeyRange.bound(`${lang}${SEP}`, `${lang}${SEP}￿`);
}
function asPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// A clip is identified by language + voice + card identity, so the same word
// can hold several voices side by side: `${lang}::${voiceId}::${entryKey}`.
// `source` distinguishes per-sound-source clips on multi-source libraries
// (Japanese: kanji-spoken vs hiragana-spoken) and is appended only when set, so
// single-source languages (Spanish, Farsi) keep their original sourceless keys.
export function clipKey(lang, voiceId, entryKey, source = "") {
  const base = `${lang}${SEP}${voiceId}${SEP}${entryKey}`;
  return source ? `${base}${SEP}${source}` : base;
}

// The card-identity key for an entry under a SPECIFIC library's field mapping
// (mirrors shared.js entryKey, but explicit about which library — used to match
// clips for any deck, not just the active one).
export function entryKeyFor(entry, lib) {
  const f = lib.fields || {};
  const t = (key) => (key ? String(entry?.[key] ?? "").trim() : "");
  return [t(f.primary), t(f.reading), t(f.translation)].join("|");
}
export function clipKeyForEntry(entry, lib, voiceId, source = "") {
  return clipKey(lib.language, voiceId, entryKeyFor(entry, lib), source);
}

// First stored clip for a card across an ordered list of preferred voices —
// returns { blob, voiceId, source } for the first voice that has one, else null.
// `source` may be a single source value or an ORDERED list of fallback sources:
// the generator drops a source's clip when it is byte-identical to another
// (Japanese: a word read correctly via kanji needs no separate hiragana clip),
// so playback asks for the active source first, then the alternatives. Voice
// priority wins over source — a top voice's fallback clip beats a lower voice's
// exact-source clip.
export async function firstClip(lang, entryKey, voiceIds, source = "") {
  const sources = Array.isArray(source) ? (source.length ? source : [""]) : [source];
  for (const voiceId of voiceIds) {
    for (const src of sources) {
      const blob = await getClip(clipKey(lang, voiceId, entryKey, src));
      if (blob) return { blob, voiceId, source: src };
    }
  }
  return null;
}

export async function getClip(key) {
  try {
    const store = await tx("readonly");
    return (await asPromise(store.get(key))) || null;
  } catch {
    return null;
  }
}

export async function putClip(key, blob) {
  const store = await tx("readwrite");
  return asPromise(store.put(blob, key));
}

// Count clips for a language — a scoped range count, no full key scan.
export async function countClips(lang) {
  try {
    const store = await tx("readonly");
    return await asPromise(store.count(langRange(lang)));
  } catch {
    return 0;
  }
}

// Every stored clip key, as a Set — for tallying which entries have audio.
export async function allClipKeys() {
  try {
    const store = await tx("readonly");
    return new Set((await asPromise(store.getAllKeys())).map(String));
  } catch {
    return new Set();
  }
}

// Distinct voice ids with ≥1 stored clip for a language (parsed from the keys
// `${lang}::${voiceId}::…`). Drives playback order offline. Scoped key cursor
// over the language range — never scans other languages.
export async function voiceIdsForLang(lang) {
  const prefix = `${lang}${SEP}`;
  const ids = new Set();
  try {
    const store = await tx("readonly");
    await new Promise((resolve, reject) => {
      const req = store.openKeyCursor(langRange(lang));
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) return resolve();
        const rest = String(cur.key).slice(prefix.length);
        const vid = rest.slice(0, rest.indexOf(SEP));
        if (vid) ids.add(vid);
        cur.continue();
      };
      req.onerror = () => reject(req.error);
    });
  } catch { /* offline read failed */ }
  return [...ids];
}

// Clear a language's downloadable/imported pack clips. Preserves the user's
// recordings: their archive lives in the separate REC_STORE (untouched here),
// and the active take's mirror clip (`${lang}::me::…`) is skipped so it keeps
// playing. Scoped cursor over the language range — no full scan.
export async function clearClips(lang) {
  const store = await tx("readwrite");
  const mePrefix = `${lang}${SEP}${REC_VOICE}${SEP}`;
  let removed = 0;
  await new Promise((resolve, reject) => {
    const req = store.openCursor(langRange(lang));
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur) return resolve();
      if (!String(cur.key).startsWith(mePrefix)) { cur.delete(); removed++; }
      cur.continue();
    };
    req.onerror = () => reject(req.error);
  });
  await asPromise(store.delete(META_PREFIX + lang));
  return removed;
}

// Voice metadata ({ <voiceId>: { name, locale, clips } }) embedded in an
// imported pack's "<lang>/voices.json" — lets unpublished languages (Japanese,
// imported manually) still show real voice names/regions in Settings and the
// sound menu, the same way the published manifest does for Spanish/Farsi.
// Stored under a namespaced key that never collides with clip keys (`<lang>::…`).
const META_PREFIX = `__voices__${SEP}`;
export async function putAudioMeta(lang, voices) {
  const store = await tx("readwrite");
  return asPromise(store.put(voices, META_PREFIX + lang));
}
export async function getAudioMeta(lang) {
  try {
    const store = await tx("readonly");
    return (await asPromise(store.get(META_PREFIX + lang))) || null;
  } catch {
    return null;
  }
}

// Clear ALL pack clips (every language) + their voice metadata. Preserves the
// active-recording mirrors (`*::me::*`); the recordings archive is in REC_STORE
// and is never touched here — "Clear all" packs can't destroy your recordings.
export async function clearAllClips() {
  const store = await tx("readwrite");
  await new Promise((resolve, reject) => {
    const req = store.openCursor();
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur) return resolve();
      if (String(cur.key).split(SEP)[1] !== REC_VOICE) cur.delete();
      cur.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

// --- User recordings (multi-take) ------------------------------------------
// The user records their own pronunciation per card. A recording is a normal
// playback "voice" (id "me"): the ACTIVE take is mirrored to the standard clip
// key `${lang}::me::${entryKey}`, so all existing playback / voice-priority /
// tally code treats it like any other voice with zero special-casing. Extra
// takes are archived under their own keys, with a per-card meta record listing
// the takes + which is active. Recordings are source-less (a spoken word is the
// same whatever text-source is shown) — so the card page includes "" in its
// clip-source candidates to find them on multi-source libraries too.
export const REC_VOICE = "me";
const REC_PREFIX = `__rec__${SEP}`;          // __rec__::<lang>::<entryKey>::<takeId> -> blob
const REC_META_PREFIX = `__recmeta__${SEP}`; // __recmeta__::<lang>::<entryKey> -> { activeId, takes:[…] }
const REC_SRC_PREFIX = `__recsrc__${SEP}`;   // optional untrimmed source blob, kept for lossless re-edit
const recMetaKey = (lang, ek) => `${REC_META_PREFIX}${lang}${SEP}${ek}`;
const recTakeKey = (lang, ek, id) => `${REC_PREFIX}${lang}${SEP}${ek}${SEP}${id}`;
const recSrcKey = (lang, ek, id) => `${REC_SRC_PREFIX}${lang}${SEP}${ek}${SEP}${id}`;

// Recordings store accessors (separate object store from clips).
async function recGet(key) {
  try { const s = await recTx("readonly"); return (await asPromise(s.get(key))) || null; }
  catch { return null; }
}
async function recPut(key, value) { const s = await recTx("readwrite"); return asPromise(s.put(value, key)); }
async function recDelete(key) { const s = await recTx("readwrite"); return asPromise(s.delete(key)); }

// { activeId, takes: [{ id, createdAt, durationMs }] } for a card (newest last).
export async function listRecordings(lang, entryKey) {
  const meta = await recGet(recMetaKey(lang, entryKey));
  return meta && Array.isArray(meta.takes) ? meta : { activeId: null, takes: [] };
}
export async function getRecordingBlob(lang, entryKey, takeId) {
  return recGet(recTakeKey(lang, entryKey, takeId));
}
// The optional untrimmed source blob for a take (present only when it was saved
// with "keep trimmed audio"), enabling lossless re-edit. null otherwise.
export async function getRecordingSource(lang, entryKey, takeId) {
  return recGet(recSrcKey(lang, entryKey, takeId));
}
// Mirror the active take's blob into the CLIPS store at the canonical `me` clip
// key (or remove it when there is no active take), so normal playback / tally /
// settings treat recordings as an ordinary voice. The take archive + meta stay
// in REC_STORE; only this one mirror lives among the clips.
async function mirrorActiveRecording(lang, entryKey, meta) {
  const meKey = clipKey(lang, REC_VOICE, entryKey, "");
  const blob = meta.activeId ? await recGet(recTakeKey(lang, entryKey, meta.activeId)) : null;
  const store = await tx("readwrite");
  if (blob) await asPromise(store.put(blob, meKey));
  else await asPromise(store.delete(meKey));
}
// Save a new take. `blob` is the trimmed clip that plays. `opts` may carry the
// untrimmed `sourceBlob` (kept for lossless re-edit) + the trim bounds it was
// cut at, recorded in the take's meta.
export async function addRecording(lang, entryKey, blob, durationMs, opts = {}) {
  const id = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  await recPut(recTakeKey(lang, entryKey, id), blob);
  if (opts.sourceBlob) await recPut(recSrcKey(lang, entryKey, id), opts.sourceBlob);
  const meta = await listRecordings(lang, entryKey);
  meta.takes.push({
    id, createdAt: Date.now(), durationMs: Math.round(durationMs) || 0,
    hasSource: !!opts.sourceBlob, trimStart: opts.trimStart || 0, trimEnd: opts.trimEnd || 0,
    fullDurationMs: Math.round(opts.fullDurationMs) || Math.round(durationMs) || 0
  });
  if (!meta.activeId) meta.activeId = id; // first take becomes the active one
  await recPut(recMetaKey(lang, entryKey), meta);
  await mirrorActiveRecording(lang, entryKey, meta);
  return id;
}
// Re-save an existing take in place (re-edit): replace its trimmed clip + meta,
// add/replace/clear the kept source, and re-mirror if it's the active take.
export async function updateRecording(lang, entryKey, takeId, blob, durationMs, opts = {}) {
  const meta = await listRecordings(lang, entryKey);
  const take = meta.takes.find((t) => t.id === takeId);
  if (!take) return;
  await recPut(recTakeKey(lang, entryKey, takeId), blob);
  if (opts.sourceBlob) await recPut(recSrcKey(lang, entryKey, takeId), opts.sourceBlob);
  else await recDelete(recSrcKey(lang, entryKey, takeId));
  take.durationMs = Math.round(durationMs) || 0;
  take.hasSource = !!opts.sourceBlob;
  take.trimStart = opts.trimStart || 0;
  take.trimEnd = opts.trimEnd || 0;
  take.fullDurationMs = Math.round(opts.fullDurationMs) || take.durationMs;
  await recPut(recMetaKey(lang, entryKey), meta);
  if (meta.activeId === takeId) await mirrorActiveRecording(lang, entryKey, meta);
}
export async function setActiveRecording(lang, entryKey, takeId) {
  const meta = await listRecordings(lang, entryKey);
  if (!meta.takes.some((t) => t.id === takeId)) return;
  meta.activeId = takeId;
  await recPut(recMetaKey(lang, entryKey), meta);
  await mirrorActiveRecording(lang, entryKey, meta);
}
export async function deleteRecording(lang, entryKey, takeId) {
  await recDelete(recTakeKey(lang, entryKey, takeId));
  await recDelete(recSrcKey(lang, entryKey, takeId));
  const meta = await listRecordings(lang, entryKey);
  meta.takes = meta.takes.filter((t) => t.id !== takeId);
  // If the active take was deleted, fall back to the newest remaining one.
  if (meta.activeId === takeId) meta.activeId = meta.takes.length ? meta.takes[meta.takes.length - 1].id : null;
  await recPut(recMetaKey(lang, entryKey), meta);
  await mirrorActiveRecording(lang, entryKey, meta);
}

// The published audio-pack manifest: { <lang>: { version, clips } }. Cheap to
// fetch (small JSON) — lets the UI know which packs exist and their versions
// without downloading the zips. Returns {} if absent.
export async function fetchAudioManifest() {
  try {
    const res = await fetch("public/audio/manifest.json", { cache: "reload" });
    if (!res.ok) return {};
    return await res.json();
  } catch {
    return {};
  }
}

// Ask the browser to keep this storage from being evicted (best-effort).
export async function requestPersist() {
  try {
    if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist();
  } catch {}
  return false;
}

// --- Minimal ZIP reader (no dependencies) ----------------------------------
// Parses the central directory and inflates deflated entries with the built-in
// DecompressionStream. Audio in a zip is usually "stored" (method 0) since it's
// already compressed, so most entries are a straight byte-slice.
async function inflateRaw(bytes) {
  const stream = new Response(bytes).body.pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function findEocd(view) {
  // EOCD signature 0x06054b50, within the last ~64KB (no zip comment in ours).
  for (let i = view.byteLength - 22; i >= Math.max(0, view.byteLength - 66000); i--) {
    if (view.getUint32(i, true) === 0x06054b50) return i;
  }
  return -1;
}

// unzip(arrayBuffer) → [{ name, blob }] for every file entry (dirs skipped).
export async function unzip(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const view = new DataView(arrayBuffer);
  const eocd = findEocd(view);
  if (eocd < 0) throw new Error("not a zip file (no end-of-central-directory record)");
  const total = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true); // central directory offset
  const out = [];
  for (let i = 0; i < total; i++) {
    if (view.getUint32(p, true) !== 0x02014b50) break; // central dir header
    const method = view.getUint16(p + 10, true);
    const compSize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOff = view.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/")) continue; // directory entry
    // Local header: data starts after its own name+extra fields.
    const lNameLen = view.getUint16(localOff + 26, true);
    const lExtraLen = view.getUint16(localOff + 28, true);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const comp = bytes.subarray(dataStart, dataStart + compSize);
    const data = method === 0 ? comp : await inflateRaw(comp);
    out.push({ name, blob: new Blob([data], { type: "audio/mp4" }) });
  }
  return out;
}

// Import clips from a .zip (File or ArrayBuffer). Each entry path is the 1-1
// mirror `<lang>/<deckId>/<slug>.m4a`; map it back to a card (via the shared
// audioSlug) and store the blob under that card's identity key. `onProgress(done,
// total)` is called as clips are stored. Returns { matched, unmatched, skipped }
// — `skipped` lists languages whose pack is already imported at the same version
// (so the slow re-import is avoided); a real content change has a new version and
// re-imports normally.
export async function importAudioZip(fileOrBuffer, onProgress) {
  const buffer = fileOrBuffer instanceof Blob ? await fileOrBuffer.arrayBuffer() : fileOrBuffer;
  const all = await unzip(buffer);
  // Read each embedded "<lang>/voices.json" ({ version, voices }), and decide
  // which languages are already imported at that exact version (skip those).
  const packs = {};
  for (const e of all) {
    const parts = e.name.split("/");
    if (parts.length === 2 && parts[1] === "voices.json") {
      try { packs[parts[0]] = JSON.parse(await e.blob.text()); } catch { /* malformed */ }
    }
  }
  const skip = new Set();
  for (const [lang, meta] of Object.entries(packs)) {
    const ver = meta && meta.version;
    if (!ver) continue;
    const existing = await getAudioMeta(lang);
    if (existing && existing.version === ver && (await countClips(lang)) > 0) skip.add(lang);
  }
  // Persist the metadata (names/locales/sizes/version) for every pack present.
  for (const [lang, meta] of Object.entries(packs)) await putAudioMeta(lang, meta);

  const entries = all.filter((e) => /\.m4a$/i.test(e.name) && !skip.has(e.name.split("/")[0]));
  const total = entries.length;
  const byLang = new Map();
  for (const item of entries) {
    const lang = item.name.split("/")[0];
    if (!byLang.has(lang)) byLang.set(lang, []);
    byLang.get(lang).push(item);
  }
  let matched = 0, unmatched = 0, done = 0;
  const tick = () => { done++; if (onProgress && (done % 50 === 0 || done === total)) onProgress(done, total); };
  for (const [lang, items] of byLang) {
    let bundle;
    try { bundle = await (await fetch(`data/${lang}/cards.json`)).json(); }
    catch { unmatched += items.length; for (const _ of items) tick(); continue; }
    const deckById = new Map(bundle.decks.map((d) => [d.id, d]));
    for (const { name, blob } of items) {
      tick();
      // <lang>/<voiceId>/<deckId…>/<slug>[.<source>].m4a
      const segs = name.split("/");
      const voiceId = segs[1];
      const stem = segs[segs.length - 1].replace(/\.[^.]+$/, "");
      const deckId = segs.slice(2, -1).join("/");
      const deck = deckById.get(deckId);
      const lib = deck && LIBRARIES.find((l) => l.language === lang && l.deckKind === (deck.kind || "word"));
      // On multi-source libraries the filename carries a ".<source>" suffix
      // (e.g. "<slug>.kanji"); split it back off so the clip lands under the
      // matching per-source key. Single-source libs have no suffix.
      let slug = stem, source = "";
      if (lib && audioMultiSource(lib)) {
        for (const s of lib.soundSources) {
          if (stem.endsWith(`.${s.value}`)) { source = s.value; slug = stem.slice(0, -(s.value.length + 1)); break; }
        }
      }
      const entry = lib && voiceId && deck.entries.find((e) => audioSlug(e, lib) === slug);
      if (!entry) { unmatched++; continue; }
      await putClip(clipKeyForEntry(entry, lib, voiceId, source), blob);
      matched++;
    }
  }
  return { matched, unmatched, skipped: [...skip] };
}
