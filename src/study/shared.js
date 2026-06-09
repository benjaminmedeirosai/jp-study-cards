// Shared state, data loading, and DOM helpers.
// Pure set-building algorithms live in ./sets.js.

const STORAGE_KEY = "jp-study-cards-state-v1";
export const DEFAULT_SET_SIZE = 20;
export const FONT_SCALE_OPTIONS = [10, 20, 35, 50, 75, 100, 125, 150, 200, 250];
export const VOICE_RATE_OPTIONS = [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
export const LINK_TEMPLATES = {
  chatgpt: "https://chat.openai.com/?q=",
  googleImages: "https://www.google.com/search?tbm=isch&q="
};
export const MODES = [
  { id: "kanji", label: "Kanji" },
  { id: "english", label: "English" },
  { id: "hiragana", label: "Hiragana" },
  { id: "voice", label: "Voice" },
  { id: "show-all", label: "Show All" }
];
export const SET_GROUPINGS = [
  { id: "kanji-alpha", label: "Alphabetical (kanji)", shortLabel: "漢 A-Z", key: "kanji", type: "alpha" },
  { id: "hiragana-alpha", label: "Alphabetical (hiragana)", shortLabel: "かな A-Z", key: "hiragana", type: "alpha" },
  { id: "kanji-likeness-slotting", label: "Kanji - likeness slotting", shortLabel: "漢 slot", key: "kanji", type: "slotting" },
  { id: "kanji-likeness-grouping", label: "Kanji - likeness grouping *", shortLabel: "漢 group", key: "kanji", type: "grouping" },
  { id: "hiragana-likeness-slotting", label: "Hiragana - likeness slotting", shortLabel: "かな slot", key: "hiragana", type: "slotting" },
  { id: "hiragana-likeness-grouping", label: "Hiragana - likeness grouping *", shortLabel: "かな group", key: "hiragana", type: "grouping" }
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
  if (value === "kanji-likeness") return "kanji-likeness-slotting";
  if (value === "hiragana-likeness") return "hiragana-likeness-slotting";
  return SET_GROUPINGS.some((grouping) => grouping.id === value) ? value : "kanji-alpha";
}

export function loadState() {
  let raw = {};
  try { raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); } catch {}
  const visible = raw.visible && typeof raw.visible === "object" ? raw.visible : {};
  return {
    deckId: String(raw.deckId || ""),
    setId: String(raw.setId || "all"),
    mode: MODES.some((mode) => mode.id === raw.mode) ? raw.mode : "kanji",
    setSize: clampInt(raw.setSize, DEFAULT_SET_SIZE, 5, 100),
    setGrouping: normalizeSetGrouping(raw.setGrouping),
    kanjiFontScale: clampInt(raw.kanjiFontScale, 100, 50, 150),
    hiraganaFontScale: clampInt(raw.hiraganaFontScale, 100, 50, 150),
    englishFontScale: clampInt(raw.englishFontScale, 100, 50, 150),
    glossFontScale: clampInt(raw.glossFontScale, 100, 50, 150),
    currentIndex: clampInt(raw.currentIndex, 0, 0, 100000),
    query: String(raw.query || "").trim(),
    jpVoice: String(raw.jpVoice || ""),
    voiceRate: Number.isFinite(Number(raw.voiceRate)) ? Math.min(2, Math.max(0.5, Number(raw.voiceRate))) : 0.9,
    showHotkeys: raw.showHotkeys === true,
    showGloss: raw.showGloss !== false,
    autoplayQuestionDelay: clampNum(raw.autoplayQuestionDelay, 4, 0.5, 60),
    autoplayAnswerDelay: clampNum(raw.autoplayAnswerDelay, 3, 0.5, 60),
    autoplayEstimateTts: raw.autoplayEstimateTts !== false,
    audioSourceExpanded: raw.audioSourceExpanded !== false,
    visible: {
      kanji: visible.kanji !== false,
      type: visible.type !== false,
      hiragana: visible.hiragana !== false,
      english: visible.english !== false
    },
    ttsSources: raw.ttsSources && typeof raw.ttsSources === "object" ? raw.ttsSources : {}
  };
}

export function saveState(state) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
}

export function text(entry, key) {
  return String(entry?.[key] ?? "").trim();
}

export function entryKey(entry) {
  return [text(entry, "kanji"), text(entry, "hiragana"), text(entry, "english")].join("|");
}

export function searchText(entry) {
  return [entry?.kanji, entry?.hiragana, entry?.english, entry?.type].join(" ").toLowerCase();
}

export function studySearchText(entry) {
  return text(entry, "kanji") || text(entry, "hiragana") || text(entry, "english");
}

export function openSearchLink(template, entry) {
  const value = studySearchText(entry);
  if (value) window.open(template + encodeURIComponent(value), "_blank");
}

// ---------------------------------------------------------------------------
// Data loading (one bundled file, cached for the page lifetime)
// ---------------------------------------------------------------------------

let bundlePromise = null;

// No leading slash, so it resolves under any base path (e.g. a GitHub Pages
// project subpath like /jp-study-cards/).
export function loadBundle() {
  if (!bundlePromise) {
    bundlePromise = fetch("data/cards.json")
      .then((response) => {
        if (!response.ok) throw new Error(`data/cards.json: ${response.status}`);
        return response.json();
      })
      .catch((error) => { bundlePromise = null; throw error; });
  }
  return bundlePromise;
}

export function listDecks(bundle) {
  return Array.isArray(bundle?.decks) ? bundle.decks : [];
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
let matchCache = { query: null, counts: null };
export function deckMatchCounts(bundle, query) {
  const q = String(query || "").trim().toLowerCase();
  if (matchCache.query === q && matchCache.counts) return matchCache.counts;
  const counts = new Map();
  for (const deck of listDecks(bundle)) {
    counts.set(deck.id, q ? (deck.entries || []).filter((entry) => searchText(entry).includes(q)).length : Number(deck.count || 0));
  }
  matchCache = { query: q, counts };
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
