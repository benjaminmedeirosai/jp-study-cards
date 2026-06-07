// Shared state, data loading, and DOM helpers.
// Pure set-building algorithms live in ./sets.js.

const STORAGE_KEY = "jp-study-cards-state-v1";
export const DEFAULT_SET_SIZE = 20;
export const FONT_SCALE_OPTIONS = [10, 20, 35, 50, 75, 100, 125, 150, 200, 250];
export const LINK_TEMPLATES = {
  chatgpt: "https://chat.openai.com/?q=",
  googleImages: "https://www.google.com/search?tbm=isch&q="
};
export const MODES = [
  { id: "kanji", label: "Kanji" },
  { id: "english", label: "English" },
  { id: "hiragana", label: "Hiragana" },
  { id: "voice", label: "Voice" }
];
export const SET_GROUPINGS = [
  { id: "kanji-alpha", label: "Alphabetical (kanji)", key: "kanji", type: "alpha" },
  { id: "hiragana-alpha", label: "Alphabetical (hiragana)", key: "hiragana", type: "alpha" },
  { id: "kanji-likeness-slotting", label: "Kanji - likeness slotting", key: "kanji", type: "slotting" },
  { id: "kanji-likeness-grouping", label: "Kanji - likeness grouping *", key: "kanji", type: "grouping" },
  { id: "hiragana-likeness-slotting", label: "Hiragana - likeness slotting", key: "hiragana", type: "slotting" },
  { id: "hiragana-likeness-grouping", label: "Hiragana - likeness grouping *", key: "hiragana", type: "grouping" }
];

export function clampInt(value, fallback, min, max) {
  const next = Math.floor(Number(value));
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
    deckId: String(raw.deckId || "all"),
    setId: String(raw.setId || "all"),
    mode: MODES.some((mode) => mode.id === raw.mode) ? raw.mode : "kanji",
    setSize: clampInt(raw.setSize, DEFAULT_SET_SIZE, 5, 100),
    setGrouping: normalizeSetGrouping(raw.setGrouping),
    kanjiFontScale: clampInt(raw.kanjiFontScale, 150, 10, 250),
    hiraganaFontScale: clampInt(raw.hiraganaFontScale, 150, 10, 250),
    englishFontScale: clampInt(raw.englishFontScale, 150, 10, 250),
    currentIndex: clampInt(raw.currentIndex, 0, 0, 100000),
    query: String(raw.query || "").trim(),
    showHotkeys: raw.showHotkeys === true,
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
// Data loading + parsing
// ---------------------------------------------------------------------------

export function parseTsvDeck(source, path) {
  const lines = source.replace(/\r\n?/g, "\n").split("\n").filter((line) => line.trim());
  if (!lines.length) return [];

  const headers = lines[0].split("\t").map((header) => header.trim());
  const requiredHeaders = ["kanji", "hiragana", "type", "english"];
  if (headers.length !== requiredHeaders.length || !requiredHeaders.every((header, index) => headers[index] === header)) {
    throw new Error(`${path}: expected TSV header ${requiredHeaders.join("\t")}`);
  }

  return lines.slice(1).map((line, index) => {
    const fields = line.split("\t");
    if (fields.length !== requiredHeaders.length) {
      throw new Error(`${path}:${index + 2}: expected ${requiredHeaders.length} tab-separated fields`);
    }
    return Object.fromEntries(requiredHeaders.map((header, fieldIndex) => [header, fields[fieldIndex].trim()]));
  });
}

export async function parseDeckResponse(response, path) {
  if (path.endsWith(".tsv")) return parseTsvDeck(await response.text(), path);
  return response.json();
}

// Module-level caches so loaded data survives page navigation (cleared only on
// a full page refresh). Promises are cached to also dedupe concurrent loads.
const deckFileCache = new Map();
let indexPromise = null;

export function loadIndex() {
  if (!indexPromise) {
    indexPromise = fetch("/data/index.json")
      .then((response) => {
        if (!response.ok) throw new Error(`data/index.json: ${response.status}`);
        return response.json();
      })
      .catch((error) => { indexPromise = null; throw error; });
  }
  return indexPromise;
}

export function loadDeckFile(path) {
  if (!deckFileCache.has(path)) {
    const promise = fetch(path)
      .then((response) => {
        if (!response.ok) throw new Error(`${path}: ${response.status}`);
        return parseDeckResponse(response, path);
      })
      .catch((error) => { deckFileCache.delete(path); throw error; });
    deckFileCache.set(path, promise);
  }
  return deckFileCache.get(path);
}

export async function loadDeckCards(deck) {
  const paths = deck?.paths || (deck?.path ? [deck.path] : []);
  const all = [];
  for (const path of paths) all.push(...(await loadDeckFile(path)));
  return all;
}

export function listDecks(index) {
  return Array.isArray(index?.decks) ? index.decks : [];
}

// Decks whose category folder is `path` or nested beneath it.
function decksInFolder(decks, path) {
  return decks.filter((deck) => {
    const category = String(deck.category || "");
    return category === path || category.startsWith(`${path} / `);
  });
}

// Resolve a stored deckId to its label, category breadcrumb, and file paths.
// "all" → whole collection; "folder:<path>" → a folder (all files beneath it);
// anything else → a single file deck by id.
export function resolveDeck(index, deckId) {
  const decks = listDecks(index);
  if (!deckId || deckId === "all") {
    return {
      id: "all",
      label: "All cards",
      category: "",
      paths: decks.map((deck) => deck.path),
      count: decks.reduce((sum, deck) => sum + Number(deck.count || 0), 0)
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
      paths: inFolder.map((deck) => deck.path),
      count: inFolder.reduce((sum, deck) => sum + Number(deck.count || 0), 0)
    };
  }
  const deck = decks.find((item) => item.id === deckId);
  if (!deck) return null;
  return { id: deck.id, label: deck.label, category: String(deck.category || ""), paths: [deck.path], count: Number(deck.count || 0) };
}

// Breadcrumb for the summary line, e.g. "Nouns / Animals / Animal Related".
export function deckBreadcrumb(deck) {
  if (!deck || deck.id === "all") return "All cards";
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
