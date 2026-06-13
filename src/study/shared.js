// Shared state, data loading, and DOM helpers.
// Pure set-building algorithms live in ./sets.js.

import { getLibrary, normalizeLibraryId, DEFAULT_LIBRARY_ID } from "./libraries.js";

const STORAGE_KEY = "jp-study-cards-state-v1";
const STATE_VERSION = 2;
// Keys that belong to the active library (isolated per language). Everything
// else in `state` is global (fonts, voice, UI prefs) and shared across libraries.
const LIBRARY_KEYS = [
  "deckId", "setId", "currentIndex", "query", "mode", "setGrouping",
  "kanjiFont", "hiraganaFont", "kanjiBold", "hiraganaBold",
  "voice", "ttsSources", "soundSource", "deckHistory", "filterHistory"
];
export const DEFAULT_SET_SIZE = 20;
export const FONT_SCALE_OPTIONS = [10, 20, 35, 50, 75, 100, 125, 150, 200, 250];
export const VOICE_RATE_OPTIONS = [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

// Japanese-text font choices. These are candidate *system* font families that
// may or may not be installed on a given device (no web downloads) — so the
// settings dropdown only lists the ones detected as available here (see
// availableFonts). `family` is the exact name we probe and request; `generic`
// is the CSS fallback bucket; optional `alt` lists extra family names the same
// font ships under on other platforms (each is probed/requested too). The
// "default" entry inherits the card font; entries with no `family` but a
// `generic` are the always-offered generic buckets (no detection needed).
export const FONT_FAMILIES = [
  { id: "default", label: "Default", family: "", generic: "" },
  // Generic system buckets — always offered, since there's no named family to
  // detect. On Android/Chrome (e.g. Samsung), where none of the named families
  // below are installed, these still give a real serif-vs-sans choice: the OS
  // maps them to its bundled Noto Sans/Serif CJK JP for Japanese text.
  { id: "sys-sans", label: "System Sans", family: "", generic: "sans-serif" },
  { id: "sys-serif", label: "System Serif", family: "", generic: "serif" },
  // Noto — Android's bundled Japanese fonts (also common via Google Fonts).
  // `alt` covers the on-device family name ("… CJK JP") vs the subset name.
  { id: "noto-sans-jp", label: "Noto Sans JP (sans)", family: "Noto Sans JP", generic: "sans-serif", alt: ["Noto Sans CJK JP"] },
  { id: "noto-serif-jp", label: "Noto Serif JP (serif)", family: "Noto Serif JP", generic: "serif", alt: ["Noto Serif CJK JP"] },
  // Cross-platform staples
  { id: "mincho-yu", label: "Yu Mincho (serif)", family: "Yu Mincho", generic: "serif" },
  { id: "mincho-hiragino", label: "Hiragino Mincho (serif)", family: "Hiragino Mincho ProN", generic: "serif" },
  { id: "mincho-ms", label: "MS Mincho (serif)", family: "MS Mincho", generic: "serif" },
  { id: "gothic-yu", label: "Yu Gothic (sans)", family: "Yu Gothic", generic: "sans-serif" },
  { id: "gothic-hiragino", label: "Hiragino Kaku Gothic (sans)", family: "Hiragino Kaku Gothic ProN", generic: "sans-serif" },
  { id: "gothic-meiryo", label: "Meiryo (sans)", family: "Meiryo", generic: "sans-serif" },
  { id: "gothic-ms", label: "MS Gothic (sans)", family: "MS Gothic", generic: "sans-serif" },
  { id: "maru-hiragino", label: "Hiragino Maru Gothic (round)", family: "Hiragino Maru Gothic ProN", generic: "sans-serif" },
  // Textbook / handwriting styles
  { id: "klee", label: "Klee (textbook)", family: "Klee One", generic: "serif" },
  { id: "kyokasho-yu", label: "Yu Kyokasho (textbook)", family: "YuKyokasho", generic: "serif" },
  { id: "kyokasho-ud", label: "UD Digi Kyokasho (textbook)", family: "UD Digi Kyokasho NK-R", generic: "sans-serif" },
  { id: "kaisho", label: "Kaisho (brush)", family: "Toppan Bunkyu Midashi Mincho", generic: "serif" },
  // Display / novelty (the "weird TV" ones — device-dependent)
  { id: "pop", label: "Sōei Kaku Pop (pop)", family: "HGSoeiKakupoptai", generic: "sans-serif" },
  { id: "creative", label: "Sōei Pres. (display)", family: "HGSoeiPresenceEB", generic: "sans-serif" },
  { id: "marugo", label: "HG Maru Gothic (round)", family: "HGMaruGothicMPRO", generic: "sans-serif" }
];

// CSS font-family for a saved font id: the named family (plus any `alt` names)
// ahead of its generic bucket; the generic alone for the generic-bucket entries;
// "inherit" (the card default) for "default" or any unknown id.
export function fontStack(id) {
  const font = FONT_FAMILIES.find((f) => f.id === id);
  if (!font) return "inherit";
  const names = [font.family, ...(font.alt || [])].filter(Boolean);
  if (names.length) return `${names.map((n) => `"${n}"`).join(", ")}, ${font.generic}`;
  return font.generic || "inherit";
}

function normalizeFont(value) {
  return FONT_FAMILIES.some((f) => f.id === value) ? value : "default";
}

// --- Font sizes --------------------------------------------------------------
// Sizes are absolute pixels, exposed directly — the number IS the rendered size,
// so the same value on any slot (kanji, reading, english, gloss) renders the
// same size. The slider moves in even steps but the px values grow geometrically
// across the range, so each notch is a constant *ratio* (~14%) rather than a
// constant +Npx — equal perceived change at the small and large ends alike.
export const FONT_PX_MIN = 8;
export const FONT_PX_MAX = 192;
export const FONT_PX_STEPS = 24;
const FONT_PX_RATIO = FONT_PX_MAX / FONT_PX_MIN;
// Default sizes, each landing exactly on a step (see fontStepToPx) so the slider
// starts pinned and a first nudge doesn't jump. Kanji largest, then reading,
// english, gloss.
export const FONT_PX_DEFAULTS = { kanji: 67, hiragana: 34, english: 18, gloss: 16 };
export function fontStepToPx(step) {
  const s = clampInt(step, 0, 0, FONT_PX_STEPS);
  return Math.round(FONT_PX_MIN * Math.pow(FONT_PX_RATIO, s / FONT_PX_STEPS));
}
export function fontPxToStep(px) {
  const p = clampNum(px, FONT_PX_MIN, FONT_PX_MIN, FONT_PX_MAX);
  return Math.round(FONT_PX_STEPS * (Math.log(p / FONT_PX_MIN) / Math.log(FONT_PX_RATIO)));
}

// --- System font detection ---------------------------------------------------
// Canvas width-comparison probe: a family that is actually installed renders the
// sample at a different width than the generic baseline it falls back to. We test
// against all three generics so a font close to one is still caught by another.
let _fontProbeCtx = null;
const FONT_PROBE_TEXT = "あいうえお漢字ガギグ日本語ABCabc012";
const FONT_PROBE_BASES = ["monospace", "serif", "sans-serif"];
function probeWidth(fontFamily) {
  if (!_fontProbeCtx) _fontProbeCtx = document.createElement("canvas").getContext("2d");
  _fontProbeCtx.font = `72px ${fontFamily}`;
  return _fontProbeCtx.measureText(FONT_PROBE_TEXT).width;
}
export function isFontAvailable(family) {
  if (!family) return true;
  return FONT_PROBE_BASES.some((base) => probeWidth(`"${family}", ${base}`) !== probeWidth(base));
}

// The font choices to actually offer: "default" plus every candidate detected on
// this device, plus any ids in `keepIds` (e.g. the current selection) so a saved
// pick never silently vanishes even if detection misses it.
export function availableFonts(keepIds = []) {
  const keep = new Set(keepIds);
  return FONT_FAMILIES.filter((font) =>
    !font.family
    || keep.has(font.id)
    || [font.family, ...(font.alt || [])].some(isFontAvailable));
}
export const LINK_TEMPLATES = {
  chatgpt: "https://chat.openai.com/?q=",
  googleImages: "https://www.google.com/search?tbm=isch&q="
};
// A mode's `slot` is the logical field it puts on the question side (front).
// voice/show-all have no front field. Libraries pick which modes they offer.
export const MODES = [
  { id: "kanji", label: "Kanji", slot: "primary" },
  { id: "english", label: "English", slot: "translation" },
  { id: "hiragana", label: "Hiragana", slot: "reading" },
  { id: "voice", label: "Voice" },
  { id: "show-all", label: "Show All" },
  { id: "spanish", label: "Spanish", slot: "primary" },
  // Kanji-schema modes: prompt with the meaning or the readings, recall the char.
  { id: "meaning", label: "Meaning", slot: "translation" },
  { id: "reading", label: "Reading", slot: "reading" },
  // Farsi words: word (primary). Farsi alphabet has its own mode-addressable
  // fields (handled directly in the alpha render, no generic slot needed):
  // letter + the two names + the three connecting forms.
  { id: "word", label: "Word", slot: "primary" },
  { id: "letter", label: "Letter" },
  { id: "name-fa", label: "Name (Farsi)" },
  { id: "name-en", label: "Name (English)" },
  { id: "initial", label: "Initial" },
  { id: "medial", label: "Medial" },
  { id: "final", label: "Final" }
];
// `slot` = which logical field this groups/sorts by; `unit` = the likeness
// extractor for the slotting/grouping variants (han chars, kana units, or Latin
// letters). Libraries pick which groupings they offer.
export const SET_GROUPINGS = [
  { id: "kanji-alpha", label: "Alphabetical (kanji)", shortLabel: "漢 A-Z", slot: "primary", type: "alpha" },
  { id: "hiragana-alpha", label: "Alphabetical (hiragana)", shortLabel: "かな A-Z", slot: "reading", type: "alpha" },
  { id: "kanji-likeness-slotting", label: "Kanji - likeness slotting", shortLabel: "漢 slot", slot: "primary", type: "slotting", unit: "han" },
  { id: "kanji-likeness-grouping", label: "Kanji - likeness grouping *", shortLabel: "漢 group", slot: "primary", type: "grouping", unit: "han" },
  { id: "hiragana-likeness-slotting", label: "Hiragana - likeness slotting", shortLabel: "かな slot", slot: "reading", type: "slotting", unit: "kana" },
  { id: "hiragana-likeness-grouping", label: "Hiragana - likeness grouping *", shortLabel: "かな group", slot: "reading", type: "grouping", unit: "kana" },
  { id: "primary-alpha", label: "Alphabetical", shortLabel: "A-Z", slot: "primary", type: "alpha" },
  { id: "primary-likeness-slotting", label: "Letter - likeness slotting", shortLabel: "A slot", slot: "primary", type: "slotting", unit: "letter" },
  { id: "primary-likeness-grouping", label: "Letter - likeness grouping *", shortLabel: "A group", slot: "primary", type: "grouping", unit: "letter" }
];

export function clampInt(value, fallback, min, max) {
  const next = Math.floor(Number(value));
  if (!Number.isFinite(next)) return fallback;
  return Math.max(min, Math.min(max, next));
}

export function clampNum(value, fallback, min, max) {
  const next = Number(value);
  if (!Number.isFinite(next)) return fallback;
  return Math.max(min, Math.min(max, next));
}

export function normalizeSetGrouping(value) {
  if (value === "kanji-likeness") value = "kanji-likeness-slotting";
  if (value === "hiragana-likeness") value = "hiragana-likeness-slotting";
  const allowed = activeLibrary().groupingIds;
  return allowed.includes(value) ? value : allowed[0];
}

// The active library id (seeded from storage). Drives activeLibrary() and which
// per-library slice loadState/saveState read & write.
let currentLibraryId = null;

// Read the persisted store, migrating the legacy flat v1 blob into the v2
// { version, libraryId, global, libraries } shape (lossless: existing keys land
// under global / libraries.japanese).
function readStore() {
  let stored = {};
  try { stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); } catch {}
  let store;
  if (stored && stored.version === STATE_VERSION && stored.libraries) {
    store = stored;
  } else {
    const library = {};
    const global = { ...stored };
    for (const key of LIBRARY_KEYS) {
      if (key in stored) library[key] = stored[key];
      delete global[key];
    }
    delete global.version; delete global.libraryId; delete global.libraries;
    store = {
      version: STATE_VERSION,
      libraryId: normalizeLibraryId(stored.libraryId || DEFAULT_LIBRARY_ID),
      global,
      libraries: { [DEFAULT_LIBRARY_ID]: library }
    };
  }
  // Former globals that are really per-library (Japanese): font family/bold and
  // the voice (renamed jpVoice→voice). Migrate each into the Japanese slice once.
  if (store.global) {
    const jp = (store.libraries[DEFAULT_LIBRARY_ID] = store.libraries[DEFAULT_LIBRARY_ID] || {});
    if ("jpVoice" in store.global) {
      if (!("voice" in jp)) jp.voice = store.global.jpVoice;
      delete store.global.jpVoice;
    }
    for (const key of ["kanjiFont", "hiraganaFont", "kanjiBold", "hiraganaBold"]) {
      if (key in store.global) {
        if (!(key in jp)) jp[key] = store.global[key];
        delete store.global[key];
      }
    }
  }
  return store;
}

export function activeLibrary() {
  return getLibrary(currentLibraryId || readStore().libraryId);
}

// Switch the active library (persists the choice; next loadState reads its slice).
export function setLibrary(id) {
  const libraryId = normalizeLibraryId(id);
  const store = readStore();
  store.libraryId = libraryId;
  store.libraries = store.libraries || {};
  if (!store.libraries[libraryId]) store.libraries[libraryId] = {};
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(store)); } catch {}
  currentLibraryId = libraryId;
}

export function loadState() {
  const store = readStore();
  const libraryId = normalizeLibraryId(store.libraryId);
  currentLibraryId = libraryId;
  // Flatten global + the active library's slice so the rest of the app keeps
  // using a single `state.foo` object (persistence is split; memory isn't).
  const raw = { ...store.global, ...(store.libraries[libraryId] || {}) };
  const visible = raw.visible && typeof raw.visible === "object" ? raw.visible : {};
  return {
    libraryId,
    deckId: String(raw.deckId || ""),
    setId: String(raw.setId || "all"),
    mode: activeLibrary().modeIds.includes(raw.mode) ? raw.mode : activeLibrary().modeIds[0],
    setSize: clampInt(raw.setSize, DEFAULT_SET_SIZE, 5, 100),
    setGrouping: normalizeSetGrouping(raw.setGrouping),
    kanjiFontPx: clampInt(raw.kanjiFontPx, FONT_PX_DEFAULTS.kanji, FONT_PX_MIN, FONT_PX_MAX),
    hiraganaFontPx: clampInt(raw.hiraganaFontPx, FONT_PX_DEFAULTS.hiragana, FONT_PX_MIN, FONT_PX_MAX),
    englishFontPx: clampInt(raw.englishFontPx, FONT_PX_DEFAULTS.english, FONT_PX_MIN, FONT_PX_MAX),
    glossFontPx: clampInt(raw.glossFontPx, FONT_PX_DEFAULTS.gloss, FONT_PX_MIN, FONT_PX_MAX),
    kanjiFont: normalizeFont(raw.kanjiFont),
    hiraganaFont: normalizeFont(raw.hiraganaFont),
    kanjiBold: raw.kanjiBold === true,
    hiraganaBold: raw.hiraganaBold === true,
    currentIndex: clampInt(raw.currentIndex, 0, 0, 100000),
    query: String(raw.query || "").trim(),
    voice: String(raw.voice || ""),
    voiceRate: Number.isFinite(Number(raw.voiceRate)) ? Math.min(2, Math.max(0.5, Number(raw.voiceRate))) : 1,
    showHotkeys: raw.showHotkeys === true,
    showGloss: raw.showGloss !== false,
    autoplayQuestionDelay: clampNum(raw.autoplayQuestionDelay, 2, 0.5, 60),
    autoplayAnswerDelay: clampNum(raw.autoplayAnswerDelay, 1.5, 0.5, 60),
    autoplayEstimateTts: raw.autoplayEstimateTts !== false,
    // Voice reads only the first reading of each type by default (most common);
    // on → read every 、-separated reading. Only meaningful for multi-reading
    // schemas (kanji); harmless elsewhere.
    voiceAllReadings: raw.voiceAllReadings === true,
    audioSourceExpanded: raw.audioSourceExpanded !== false,
    visible: {
      kanji: visible.kanji !== false,
      type: visible.type !== false,
      hiragana: visible.hiragana !== false,
      english: visible.english !== false
    },
    ttsSources: raw.ttsSources && typeof raw.ttsSources === "object" ? raw.ttsSources : {},
    // Standing sound-source choice for "library"-scope schemas (e.g. kanji
    // on'yomi/kun'yomi/both). Validated against the library's options in use.
    soundSource: String(raw.soundSource || ""),
    filterHistory: Array.isArray(raw.filterHistory) ? raw.filterHistory : [],
    deckHistory: Array.isArray(raw.deckHistory) ? raw.deckHistory : []
  };
}

export function saveState(state) {
  const store = readStore();
  const libraryId = normalizeLibraryId(state.libraryId || currentLibraryId || store.libraryId);
  store.libraryId = libraryId;
  store.global = store.global || {};
  store.libraries = store.libraries || {};
  const library = store.libraries[libraryId] || {};
  for (const [key, value] of Object.entries(state)) {
    if (key === "libraryId") continue;
    if (LIBRARY_KEYS.includes(key)) library[key] = value;
    else store.global[key] = value;
  }
  store.libraries[libraryId] = library;
  currentLibraryId = libraryId;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(store)); } catch {}
}

export function text(entry, key) {
  return String(entry?.[key] ?? "").trim();
}

// Field-mapping accessors: read an entry's logical slot (primary/reading/
// translation/type/gloss) via the active library's `fields` map, so the rest of
// the app stays language-agnostic. A slot the library doesn't have → "".
export function fieldName(slot) {
  return activeLibrary().fields[slot] || null;
}
export function fieldText(entry, slot) {
  const name = fieldName(slot);
  return name ? text(entry, name) : "";
}
export const primaryText = (entry) => fieldText(entry, "primary");
export const readingText = (entry) => fieldText(entry, "reading");
export const translationText = (entry) => fieldText(entry, "translation");
export const glossText = (entry) => fieldText(entry, "gloss");
export const typeText = (entry) => fieldText(entry, "type");

export function entryKey(entry) {
  return [primaryText(entry), readingText(entry), translationText(entry)].join("|");
}

export function searchText(entry) {
  // A library may name the raw entry fields to search (kanji decks include
  // radical/components so the tap-menu can filter by them); otherwise search the
  // standard logical slots.
  const keys = activeLibrary().searchKeys;
  if (keys) return keys.map((key) => text(entry, key)).join(" ").toLowerCase();
  return [primaryText(entry), readingText(entry), translationText(entry), typeText(entry)].join(" ").toLowerCase();
}

export function studySearchText(entry) {
  return primaryText(entry) || readingText(entry) || translationText(entry);
}

export function openSearchLink(template, entry) {
  const value = studySearchText(entry);
  if (value) window.open(template + encodeURIComponent(value), "_blank");
}

// ---------------------------------------------------------------------------
// Data loading (one bundled file, cached for the page lifetime)
// ---------------------------------------------------------------------------

// Cached per data path, so switching library fetches the right bundle and each
// is fetched at most once per page. Paths have no leading slash, so they resolve
// under any base path (e.g. a GitHub Pages project subpath like /jp-study-cards/).
const bundlePromises = new Map();

export function loadBundle() {
  const url = activeLibrary().data;
  if (!bundlePromises.has(url)) {
    bundlePromises.set(url, fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error(`${url}: ${response.status}`);
        return response.json();
      })
      .catch((error) => { bundlePromises.delete(url); throw error; }));
  }
  return bundlePromises.get(url);
}

// Decks of the active library's `deckKind` only. The Japanese bundle holds both
// word decks and kanji decks (kind:"kanji"); each library shows just its own, so
// the word and kanji schemas never see each other's decks. Default kind is
// "word" (decks carry no `kind` field unless they're a special schema).
export function listDecks(bundle) {
  const all = Array.isArray(bundle?.decks) ? bundle.decks : [];
  const kind = activeLibrary().deckKind || "word";
  return all.filter((deck) => (deck.kind || "word") === kind);
}

// Decks whose category folder is `path` or nested beneath it.
function decksInFolder(decks, path) {
  return decks.filter((deck) => {
    const category = String(deck.category || "");
    return category === path || category.startsWith(`${path} / `);
  });
}

// Resolve a stored deckId to a study target with its card entries.
// "folder:<path>" → a folder (all decks beneath it, concatenated);
// a deck id → a single deck. Empty/unknown → null.
export function resolveDeck(bundle, deckId) {
  const decks = listDecks(bundle);
  if (!deckId) return null;
  if (deckId === "all") {
    if (!decks.length) return null;
    return {
      id: "all",
      label: "All decks",
      category: "",
      count: decks.reduce((sum, deck) => sum + Number(deck.count || 0), 0),
      entries: decks.flatMap((deck) => deck.entries || [])
    };
  }
  if (deckId.startsWith("folder:")) {
    const path = deckId.slice("folder:".length);
    const segments = path.split("/").map((part) => part.trim()).filter(Boolean);
    const inFolder = decksInFolder(decks, path);
    if (!inFolder.length) return null;
    return {
      id: deckId,
      label: segments[segments.length - 1] || path,
      category: segments.slice(0, -1).join(" / "),
      count: inFolder.reduce((sum, deck) => sum + Number(deck.count || 0), 0),
      entries: inFolder.flatMap((deck) => deck.entries || [])
    };
  }
  const deck = decks.find((item) => item.id === deckId);
  if (!deck) return null;
  return { id: deck.id, label: deck.label, category: String(deck.category || ""), count: Number(deck.count || 0), entries: deck.entries || [] };
}

// Per-deck count of entries matching `query`, cached by query so callers (the
// deck page) only recompute when the filter actually changed since last time.
let matchCache = { bundle: null, library: null, query: null, counts: null };
export function deckMatchCounts(bundle, query) {
  const q = String(query || "").trim().toLowerCase();
  // Keyed by library too: japanese and japanese-kanji share one bundle object
  // but listDecks filters to different decks, so the counts differ.
  const library = activeLibrary().id;
  if (matchCache.bundle === bundle && matchCache.library === library && matchCache.query === q && matchCache.counts) return matchCache.counts;
  const counts = new Map();
  for (const deck of listDecks(bundle)) {
    counts.set(deck.id, q ? (deck.entries || []).filter((entry) => searchText(entry).includes(q)).length : Number(deck.count || 0));
  }
  matchCache = { bundle, library, query: q, counts };
  return counts;
}

// Breadcrumb for the summary line, e.g. "Nouns / Animals / Animal Related".
export function deckBreadcrumb(deck) {
  if (!deck || deck.id === "all") return "All decks";
  return [deck.category, deck.label].filter(Boolean).join(" / ");
}

// Build a category tree from the slash-delimited `category` of each deck.
// Returns the top-level nodes: { name, decks: [...], children: [...node] }.
export function buildDeckTree(index) {
  const root = { name: "", decks: [], children: new Map() };
  for (const deck of listDecks(index)) {
    const segments = String(deck.category || "Other").split("/").map((part) => part.trim()).filter(Boolean);
    let node = root;
    for (const segment of segments) {
      if (!node.children.has(segment)) node.children.set(segment, { name: segment, decks: [], children: new Map() });
      node = node.children.get(segment);
    }
    node.decks.push(deck);
  }
  const toArray = (node) => ({ name: node.name, decks: node.decks, children: [...node.children.values()].map(toArray) });
  return [...root.children.values()].map(toArray);
}

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

export function button(label, className = "", icon = "") {
  const el = document.createElement("button");
  el.type = "button";
  el.className = `study-button ${className}`.trim();
  if (icon) {
    const iconEl = document.createElement("span");
    iconEl.className = "icon";
    iconEl.textContent = icon;
    const textEl = document.createElement("span");
    textEl.className = "text";
    textEl.textContent = label;
    el.append(iconEl, textEl);
  } else {
    el.textContent = label;
  }
  return el;
}

export function setButtonHotkey(buttonEl, hotkey) {
  const el = document.createElement("span");
  el.className = "hotkey";
  el.textContent = hotkey;
  buttonEl.append(el);
}

export function setButtonText(buttonEl, value) {
  const textEl = buttonEl.querySelector(".text");
  if (textEl) textEl.textContent = value;
  else buttonEl.textContent = value;
}

export function soundOptionsIcon() {
  return `
    <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <path d="M4.5 13.5h4.8l5.7-4.7v14.4l-5.7-4.7H4.5z" />
      <path d="M19 11.2a6.8 6.8 0 0 1 0 9.6" />
      <path d="M22.6 7.5a12 12 0 0 1 0 17" />
      <path d="M25.5 11h2.8" />
      <path d="M25.5 16h2.8" />
      <path d="M25.5 21h2.8" />
    </svg>`;
}

export function fieldLabel(labelText, input, className = "") {
  const label = document.createElement("label");
  label.className = `study-field ${className}`.trim();
  const span = document.createElement("span");
  span.textContent = labelText;
  label.append(span, input);
  return label;
}

export function makeSelect(items, value) {
  const select = document.createElement("select");
  for (const item of items) {
    if (item.separator) { select.append(document.createElement("hr")); continue; }
    const option = document.createElement("option");
    option.value = item.value;
    option.textContent = item.label;
    select.append(option);
  }
  select.value = value;
  return select;
}

export function makeToggle(labelText, checked) {
  const label = document.createElement("label");
  label.className = "study-toggle";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = !!checked;
  const span = document.createElement("span");
  span.textContent = labelText;
  label.append(input, span);
  return { label, input };
}

export function setSlotVisible(el, visible) {
  el.classList.toggle("is-invisible", !visible);
}
