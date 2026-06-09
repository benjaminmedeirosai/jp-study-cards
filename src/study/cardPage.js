import { speak } from "./speech.js";
import { buildSetOptions, activeSetGrouping, computeDeckSets } from "./sets.js";
import {
  MODES,
  LINK_TEMPLATES,
  loadState,
  saveState,
  text,
  entryKey,
  openSearchLink,
  loadBundle,
  resolveDeck,
  deckBreadcrumb,
  button,
  soundOptionsIcon,
  fieldLabel,
  makeSelect,
  setSlotVisible
} from "./shared.js";

// Stroked, single-color icons for the six main tray buttons — same visual
// language as the mini-rail sound icon.
const ICONS = {
  chatgpt: `<svg viewBox="0 0 24 24"><path d="M5 5h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-8l-4 4v-4H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"/><path d="M9 10h0"/><path d="M12 10h0"/><path d="M15 10h0"/></svg>`,
  sound: `<svg viewBox="0 0 24 24"><path d="M4 9.5v5h3.5L13 19V5L7.5 9.5H4z"/><path d="M16.5 9a4 4 0 0 1 0 6"/><path d="M19 6.5a8 8 0 0 1 0 11"/></svg>`,
  images: `<svg viewBox="0 0 24 24"><rect x="3" y="4.5" width="18" height="15" rx="2.5"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M4 17l5-4 4 3 3-2 4 3"/></svg>`,
  prev: `<svg viewBox="0 0 24 24"><path d="M19 12H6"/><path d="M12 6l-6 6 6 6"/></svg>`,
  next: `<svg viewBox="0 0 24 24"><path d="M5 12h13"/><path d="M12 6l6 6-6 6"/></svg>`,
  eye: `<svg viewBox="0 0 24 24"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/></svg>`,
  eyeOff: `<svg viewBox="0 0 24 24"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/><path d="M4 4l16 16"/></svg>`
};

// Split a "[漢: gloss | 漢: gloss]" breakdown into per-kanji segments for the
// top-right gloss slot. Tolerates a missing pair of brackets.
function glossSegments(breakdown) {
  return String(breakdown || "")
    .trim()
    .replace(/^\[|\]$/g, "")
    .split("|")
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function keyButton(label, className, svg, hotkey = "") {
  const el = document.createElement("button");
  el.type = "button";
  el.className = `study-button ${className}`.trim();
  el.setAttribute("aria-label", label);
  el.innerHTML = `<span class="icon">${svg}</span>`;
  if (hotkey) {
    const hint = document.createElement("span");
    hint.className = "hotkey";
    hint.textContent = hotkey;
    el.append(hint);
  }
  return el;
}

export function renderCardPage() {
  const root = document.createElement("section");
  root.className = "study-page card-page";

  let state = loadState();
  root.classList.toggle("show-hotkeys", state.showHotkeys);
  let bundle = null;
  let deckCards = [];
  let setCards = [];
  let setOptions = buildSetOptions(setCards, state.setSize, state.setGrouping);
  let revealed = false;
  let ttsExpanded = state.audioSourceExpanded;
  let renderVersion = 0;

  // --- Header -------------------------------------------------------------
  const top = document.createElement("header");
  top.className = "card-top";
  const deckButton = document.createElement("button");
  deckButton.type = "button";
  deckButton.className = "deck-chooser";
  const deckButtonIcon = document.createElement("span");
  deckButtonIcon.className = "deck-chooser-icon";
  deckButtonIcon.innerHTML = `<svg viewBox="0 0 24 24"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>`;
  const deckButtonLabel = document.createElement("span");
  deckButtonLabel.className = "deck-chooser-label";
  deckButtonLabel.textContent = "All cards";
  deckButton.append(deckButtonIcon, deckButtonLabel);
  const setSelect = makeSelect([], state.setId);
  const modeItems = [
    { value: "show-all", label: "Show All" },
    { separator: true },
    ...MODES.filter((mode) => mode.id !== "show-all").map((mode) => ({ value: mode.id, label: mode.label }))
  ];
  const modeSelect = makeSelect(modeItems, state.mode);
  const settingsBtn = button("Settings", "settings-open", "⚙");
  const summary = document.createElement("div");
  summary.className = "card-summary";
  const summaryMain = document.createElement("span");
  summaryMain.className = "card-summary-main";
  const summaryGrouping = document.createElement("span");
  summaryGrouping.className = "card-summary-grouping";
  summary.append(summaryMain, summaryGrouping);
  const deckRow = document.createElement("div");
  deckRow.className = "card-header-row deck-set-row";
  const setField = fieldLabel(`Set (${state.setSize})`, setSelect);
  const setFieldText = setField.querySelector("span");
  deckRow.append(fieldLabel("Deck", deckButton), setField);
  const settingsRow = document.createElement("div");
  settingsRow.className = "card-header-row settings-row";
  settingsRow.append(fieldLabel("Mode", modeSelect), settingsBtn);
  top.append(deckRow, settingsRow, summary);

  // --- Card ---------------------------------------------------------------
  const card = document.createElement("article");
  card.className = "card";
  const cardType = document.createElement("div");
  cardType.className = "card-slot card-type";
  const cardReading = document.createElement("div");
  cardReading.className = "card-slot card-reading";
  const cardMain = document.createElement("div");
  cardMain.className = "card-slot card-main";
  const cardEnglish = document.createElement("div");
  cardEnglish.className = "card-slot card-english";
  const cardGloss = document.createElement("div");
  cardGloss.className = "card-slot card-gloss";
  card.append(cardType, cardReading, cardMain, cardEnglish, cardGloss);

  // --- Bottom tray: mini rail above 6 main buttons ------------------------
  const tray = document.createElement("section");
  tray.className = "tray";

  const trayMini = document.createElement("div");
  trayMini.className = "tray-mini";
  const ttsToggleBtn = button("Sound options", "mini mini--tts");
  ttsToggleBtn.innerHTML = soundOptionsIcon();
  ttsToggleBtn.setAttribute("aria-label", "Toggle sound source");
  ttsToggleBtn.setAttribute("aria-expanded", "true");
  const ttsSource = document.createElement("div");
  ttsSource.className = "tts-source";
  ttsSource.setAttribute("role", "radiogroup");
  const ttsKanjiBtn = button("Kanji", "tts-option");
  const ttsReadingBtn = button("Hiragana", "tts-option");
  ttsKanjiBtn.dataset.value = "kanji";
  ttsReadingBtn.dataset.value = "hiragana";
  ttsSource.append(ttsKanjiBtn, ttsReadingBtn);
  const shuffleBtn = button("Shuffle", "mini mini--shuffle");
  shuffleBtn.innerHTML = "⇄";
  shuffleBtn.setAttribute("aria-label", "Shuffle current set");
  trayMini.append(ttsToggleBtn, ttsSource, shuffleBtn);

  const trayMain = document.createElement("div");
  trayMain.className = "tray-main";
  const chatgptBtn = keyButton("Ask ChatGPT", "key key--action chatgpt", ICONS.chatgpt);
  const soundBtn = keyButton("Play sound", "key key--action sound", ICONS.sound, "S");
  const imagesBtn = keyButton("Search images", "key key--action images", ICONS.images);
  const prevBtn = keyButton("Previous card", "key key--nav prev", ICONS.prev, "←");
  const revealBtn = keyButton("Reveal answer", "key key--reveal", ICONS.eye, "Space");
  const nextBtn = keyButton("Next card", "key key--nav next", ICONS.next, "→");
  trayMain.append(chatgptBtn, soundBtn, imagesBtn, prevBtn, revealBtn, nextBtn);

  tray.append(trayMini, trayMain);

  const empty = document.createElement("div");
  empty.className = "card-empty";
  const emptyMsg = document.createElement("p");
  emptyMsg.className = "card-empty-msg";
  const chooseDeckBtn = document.createElement("button");
  chooseDeckBtn.type = "button";
  chooseDeckBtn.className = "card-empty-action";
  chooseDeckBtn.textContent = "Choose a deck";
  chooseDeckBtn.addEventListener("click", () => { location.hash = "#/decks"; });
  empty.append(emptyMsg, chooseDeckBtn);
  root.append(top, card, empty, tray);

  // --- Deck / set selection -----------------------------------------------
  // null when nothing is selected (or the saved deck no longer exists).
  function currentDeck() {
    return resolveDeck(bundle, state.deckId);
  }

  function updateDeckButton() {
    const deck = currentDeck();
    deckButtonLabel.textContent = deck ? deck.label : "Choose deck";
  }

  function updateSetControl() {
    if (setFieldText) setFieldText.textContent = `Set (${state.setSize})`;
    setSelect.innerHTML = "";
    for (const set of setOptions) {
      const option = document.createElement("option");
      option.value = set.id;
      option.textContent = set.label;
      setSelect.append(option);
    }
    if (!setOptions.some((set) => set.id === state.setId)) state.setId = setOptions[0]?.id || "all";
    setSelect.value = state.setId;
  }

  // Cheap: slice the active set out of the already-built setOptions. Use this
  // when only the selected set changed — no re-sort / re-grouping needed.
  function applyActiveSet({ keepIndex = false } = {}) {
    const activeSet = setOptions.find((set) => set.id === state.setId) || setOptions[0];
    // Copy so in-place shuffling never mutates the cached setOptions.
    setCards = activeSet ? (activeSet.cards ? activeSet.cards.slice() : deckCards.slice(activeSet.start, activeSet.end)) : [];
    if (!keepIndex) state.currentIndex = 0;
    if (state.currentIndex >= setCards.length) state.currentIndex = Math.max(0, setCards.length - 1);
    revealed = false;
  }

  // Rebuild the deck's sets. The grouping calc itself is memoized by
  // computeDeckSets (shared with the settings preview), so this is cheap when
  // the deck, filter, set size, and grouping are unchanged.
  async function rebuildDeck({ keepIndex = false } = {}) {
    const deck = currentDeck();
    if (!deck) {
      deckCards = [];
      setOptions = buildSetOptions([], state.setSize, state.setGrouping);
      applyActiveSet({ keepIndex: false });
      return;
    }
    const result = computeDeckSets({
      cacheKey: state.deckId,
      cards: deck.entries,
      query: state.query,
      setSize: state.setSize,
      groupingId: state.setGrouping
    });
    deckCards = result.deckCards;
    setOptions = result.setOptions;
    applyActiveSet({ keepIndex });
  }

  // --- Current card / speech ----------------------------------------------
  function currentEntry() {
    return setCards[state.currentIndex] || null;
  }

  // The system default reading source for an entry. Browser TTS mis-reads
  // counter/numeral kanji (e.g. 十六匹 → ひき instead of the correct ぴき), so those
  // default to the curated hiragana; everything else defaults to kanji for
  // better pitch-accent. The user can override per card (see setTtsSource).
  function defaultTtsSource(entry) {
    return entry?.type === "counter" || entry?.type === "numeral" ? "hiragana" : "kanji";
  }

  // Effective source: the user's saved override for this card if any, else the
  // system default. Always resolves to "kanji" or "hiragana".
  function getCurrentTtsSource() {
    const entry = currentEntry();
    const saved = state.ttsSources[entryKey(entry)];
    return saved === "kanji" || saved === "hiragana" ? saved : defaultTtsSource(entry);
  }

  function getJapaneseSpeechText(entry) {
    const useReading = getCurrentTtsSource() === "hiragana";
    if (useReading) return text(entry, "hiragana") || text(entry, "kanji");
    return text(entry, "kanji") || text(entry, "hiragana");
  }

  function speakJapanese() {
    const value = getJapaneseSpeechText(currentEntry());
    if (value) speak(value, { lang: "ja-JP", voiceName: state.jpVoice, rate: state.voiceRate });
  }

  function renderTray() {
    const entry = currentEntry();
    const source = getCurrentTtsSource();
    tray.classList.toggle("tts-collapsed", !ttsExpanded);
    ttsToggleBtn.setAttribute("aria-expanded", ttsExpanded ? "true" : "false");
    ttsToggleBtn.disabled = !entry;
    ttsSource.dataset.selected = source;
    for (const btn of [ttsKanjiBtn, ttsReadingBtn]) {
      const selected = btn.dataset.value === source;
      btn.classList.toggle("active", selected);
      btn.setAttribute("role", "radio");
      btn.setAttribute("aria-checked", selected ? "true" : "false");
      btn.disabled = !entry;
    }
    chatgptBtn.disabled = !entry;
    soundBtn.disabled = !entry;
    imagesBtn.disabled = !entry;
    shuffleBtn.disabled = setCards.length <= 1;
  }

  function renderCard() {
    const entry = currentEntry();
    const total = setCards.length;
    const deck = currentDeck();
    const activeSet = setOptions.find((set) => set.id === state.setId) || setOptions[0];
    empty.hidden = total > 0;
    card.hidden = total === 0;
    tray.hidden = total === 0;
    const filter = String(state.query || "").trim();
    summaryMain.textContent = deck
      ? `${deckBreadcrumb(deck)} / ${activeSet?.summaryLabel || "Whole deck"}${filter ? ` · filter “${filter}”` : ""}`
      : "";
    summaryGrouping.textContent = deck ? activeSetGrouping(state.setGrouping).shortLabel : "";
    prevBtn.disabled = total <= 1;
    nextBtn.disabled = total <= 1;
    setSelect.disabled = total === 0;
    if (!entry) {
      const noDeck = !deck;
      emptyMsg.textContent = noDeck
        ? "No deck selected."
        : (bundle ? "No cards match this deck or filter." : "Loading Japanese words...");
      chooseDeckBtn.hidden = !noDeck;
      return;
    }
    const kanji = text(entry, "kanji");
    const hiragana = text(entry, "hiragana");
    const english = text(entry, "english");
    const type = text(entry, "type");
    const mainText = kanji || hiragana || "-";
    card.style.setProperty("--japanese-main-font-scale", String(state.kanjiFontScale / 100));
    card.style.setProperty("--japanese-reading-font-scale", String(state.hiraganaFontScale / 100));
    card.style.setProperty("--japanese-english-font-scale", String(state.englishFontScale / 100));
    card.style.setProperty("--japanese-gloss-font-scale", String(state.glossFontScale / 100));
    cardType.textContent = type;
    cardMain.textContent = mainText;
    cardReading.textContent = hiragana;
    cardEnglish.textContent = english;
    const showFront = revealed || state.mode === "show-all";
    setSlotVisible(cardType, state.visible.type && !!type);
    setSlotVisible(cardMain, (showFront ? state.visible.kanji : state.mode === "kanji") && !!mainText);
    setSlotVisible(cardReading, (showFront ? state.visible.hiragana : state.mode === "hiragana") && !!hiragana);
    setSlotVisible(cardEnglish, (showFront ? state.visible.english : state.mode === "english") && !!english);
    // Kanji gloss: top-right, one line per kanji. Shown only when enabled, the
    // entry has a breakdown, and the answer is visible (show-all or revealed).
    const segments = glossSegments(text(entry, "breakdown"));
    cardGloss.replaceChildren(...segments.map((segment) => {
      const line = document.createElement("div");
      line.className = "card-gloss-line";
      line.textContent = segment;
      return line;
    }));
    setSlotVisible(cardGloss, state.showGloss && showFront && segments.length > 0);
    revealBtn.querySelector(".icon").innerHTML = revealed ? ICONS.eyeOff : ICONS.eye;
    revealBtn.setAttribute("aria-label", revealed ? "Hide answer" : "Reveal answer");
    renderTray();
  }

  async function renderAll(options = {}) {
    const version = ++renderVersion;
    updateDeckButton();
    await rebuildDeck(options);
    if (version !== renderVersion) return;
    updateSetControl();
    renderCard();
    saveState(state);
  }

  // --- Interactions -------------------------------------------------------
  function move(delta) {
    if (!setCards.length) return;
    state.currentIndex = (state.currentIndex + delta + setCards.length) % setCards.length;
    revealed = false;
    saveState(state);
    renderCard();
    if (state.mode === "voice") speakJapanese();
  }

  function shuffleCurrentSet() {
    if (setCards.length <= 1) return;
    const originalOrder = setCards.map(entryKey).join("\n");
    const originalFirstKey = entryKey(setCards[0]);
    for (let index = setCards.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [setCards[index], setCards[swapIndex]] = [setCards[swapIndex], setCards[index]];
    }
    if (setCards.map(entryKey).join("\n") === originalOrder) setCards.push(setCards.shift());
    if (entryKey(setCards[0]) === originalFirstKey) {
      const nextFirstIndex = setCards.findIndex((entry) => entryKey(entry) !== originalFirstKey);
      if (nextFirstIndex > 0) [setCards[0], setCards[nextFirstIndex]] = [setCards[nextFirstIndex], setCards[0]];
    }
    state.currentIndex = 0;
    revealed = false;
    saveState(state);
    renderCard();
    if (state.mode === "voice") speakJapanese();
  }

  function reveal() {
    if (!currentEntry()) return;
    revealed = !revealed;
    renderCard();
    if (revealed) speakJapanese();
  }

  function setTtsSource(value) {
    const entry = currentEntry();
    const key = entryKey(entry);
    if (!key || (value !== "kanji" && value !== "hiragana")) return;
    // Persist only a deviation from the system default; choosing the default
    // clears any prior override so the card falls back to it.
    if (value === defaultTtsSource(entry)) delete state.ttsSources[key];
    else state.ttsSources[key] = value;
    saveState(state);
    renderTray();
    speakJapanese();
  }

  deckButton.addEventListener("click", () => { location.hash = "#/decks"; });
  setSelect.addEventListener("change", () => {
    // Only the selected set changed — re-slice, no re-sort/re-grouping.
    state.setId = setSelect.value;
    applyActiveSet({ keepIndex: false });
    renderCard();
    saveState(state);
  });
  modeSelect.addEventListener("change", () => {
    state.mode = modeSelect.value;
    revealed = false;
    saveState(state);
    renderCard();
    if (state.mode === "voice") speakJapanese();
  });
  settingsBtn.addEventListener("click", () => { location.hash = "#/settings"; });
  ttsToggleBtn.addEventListener("click", () => {
    ttsExpanded = !ttsExpanded;
    state.audioSourceExpanded = ttsExpanded;
    saveState(state);
    renderTray();
  });
  shuffleBtn.addEventListener("click", shuffleCurrentSet);
  ttsKanjiBtn.addEventListener("click", () => setTtsSource("kanji"));
  ttsReadingBtn.addEventListener("click", () => setTtsSource("hiragana"));
  prevBtn.addEventListener("click", () => move(-1));
  nextBtn.addEventListener("click", () => move(1));
  revealBtn.addEventListener("click", reveal);
  soundBtn.addEventListener("click", speakJapanese);
  chatgptBtn.addEventListener("click", () => openSearchLink(LINK_TEMPLATES.chatgpt, currentEntry()));
  imagesBtn.addEventListener("click", () => openSearchLink(LINK_TEMPLATES.googleImages, currentEntry()));

  function onKeydown(event) {
    if (!root.isConnected) { document.removeEventListener("keydown", onKeydown); return; }
    const tag = String(event.target?.tagName || "").toLowerCase();
    if (["input", "select", "textarea"].includes(tag) || event.target?.isContentEditable) return;
    if (event.key === "ArrowLeft") { event.preventDefault(); move(-1); }
    else if (event.key === "ArrowRight") { event.preventDefault(); move(1); }
    else if (event.key === " " || event.key === "Enter") { event.preventDefault(); reveal(); }
    else if (event.key.toLowerCase() === "s") { event.preventDefault(); speakJapanese(); }
  }
  document.addEventListener("keydown", onKeydown);

  async function initialize() {
    try {
      bundle = await loadBundle();
      await renderAll({ keepIndex: true });
      if (state.mode === "voice") speakJapanese();
    } catch (error) {
      empty.hidden = false;
      empty.textContent = `Could not load Japanese words: ${error.message || error}`;
      card.hidden = true;
      tray.hidden = true;
    }
  }

  renderCard();
  void initialize();
  return root;
}
