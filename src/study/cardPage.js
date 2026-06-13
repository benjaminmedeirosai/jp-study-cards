import { speak } from "./speech.js";
import { buildSetOptions, activeSetGrouping, computeDeckSets } from "./sets.js";
import { beginSession, endSession, sessionQualifies } from "./filters.js";
import { openOverlay, pushCardsURL, replaceCardsURL, filterInLibrary } from "./router.js";
import {
  MODES,
  LINK_TEMPLATES,
  loadState,
  saveState,
  text,
  fontStack,
  entryKey,
  openSearchLink,
  loadBundle,
  resolveDeck,
  deckBreadcrumb,
  button,
  soundOptionsIcon,
  fieldLabel,
  makeSelect,
  setSlotVisible,
  activeLibrary,
  primaryText,
  readingText,
  translationText,
  glossText,
  typeText
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
  eyeOff: `<svg viewBox="0 0 24 24"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/><path d="M4 4l16 16"/></svg>`,
  play: `<svg viewBox="0 0 24 24"><path d="M7 5l12 7-12 7z"/></svg>`,
  pause: `<svg viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>`
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

// The kanji a gloss segment is about — the part before the "落: gloss" colon
// (half- or full-width). Falls back to the whole trimmed segment.
function glossKanji(segment) {
  return String(segment).split(/[:：]/)[0].trim();
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
  // The library is fixed for this mount (switching it re-mounts via the router),
  // so the schema branch can be decided once here.
  const lib = activeLibrary();
  const schemaIsKanji = lib.deckKind === "kanji";
  const schemaIsAlpha = lib.features?.formsTable === true;     // Farsi alphabet
  const schemaIsHarakat = lib.features?.examplesTable === true; // Farsi harakat
  const rtl = lib.rtl === true;                                 // Farsi (RTL script)
  root.classList.toggle("kanji-schema", schemaIsKanji);
  root.classList.toggle("alpha-schema", schemaIsAlpha);
  root.classList.toggle("harakat-schema", schemaIsHarakat);
  root.classList.toggle("rtl-schema", rtl);
  root.classList.toggle("show-hotkeys", state.showHotkeys);
  let bundle = null;
  let deckCards = [];
  let setCards = [];
  let setOptions = buildSetOptions(setCards, state.setSize, state.setGrouping);
  let revealed = false;
  let ttsExpanded = state.audioSourceExpanded;
  let renderVersion = 0;
  let autoplaying = false;
  let autoplayToken = 0;

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
  // Only the active library's modes, "Show All" first (when offered) above a
  // separator, then the field modes in the library's declared order.
  const modeLabel = (id) => (MODES.find((mode) => mode.id === id) || {}).label || id;
  const offeredModeIds = activeLibrary().modeIds;
  const modeItems = [
    ...(offeredModeIds.includes("show-all") ? [{ value: "show-all", label: "Show All" }, { separator: true }] : []),
    ...offeredModeIds.filter((id) => id !== "show-all").map((id) => ({ value: id, label: modeLabel(id) }))
  ];
  const modeSelect = makeSelect(modeItems, state.mode);
  // Library selector — compact globe button that opens the library picker.
  const libraryBtn = button("Library", "library-open", "🌐");
  libraryBtn.setAttribute("aria-label", "Choose library");
  libraryBtn.querySelector(".icon").innerHTML =
    `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>`;
  const settingsBtn = button("Settings", "settings-open", "⚙");
  settingsBtn.querySelector(".icon").innerHTML =
    `<svg viewBox="0 0 24 24"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>`;
  // The Library button sits to the LEFT of the Deck field, as a compact globe.
  const deckRow = document.createElement("div");
  deckRow.className = "header-deck-row";
  deckRow.append(libraryBtn, fieldLabel("Deck", deckButton));
  const summary = document.createElement("div");
  summary.className = "card-summary";
  const summaryMain = document.createElement("span");
  summaryMain.className = "card-summary-main";
  const summaryGrouping = document.createElement("span");
  summaryGrouping.className = "card-summary-grouping";
  summary.append(summaryMain, summaryGrouping);
  // Header controls live in ONE 2×2 grid so the columns share tracks: Deck and
  // Set sit in the same wide left column (identical width, left edges aligned),
  // Settings and Mode in the same narrow right column. The Library globe rides
  // at the left of the Deck row.
  //   Row 1: [Library] Deck | Settings   Row 2: Set | Mode
  const setField = fieldLabel(`Set (${state.setSize})`, setSelect);
  const setFieldText = setField.querySelector("span");
  const headerControls = document.createElement("div");
  headerControls.className = "card-header-grid";
  headerControls.append(
    deckRow,
    settingsBtn,
    setField,
    fieldLabel("Mode", modeSelect)
  );
  top.append(headerControls, summary);

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
  // Farsi alphabet uses a dedicated layout (its own absolutely-positioned canvas),
  // not the five word slots — so it isn't contorted to fit the word card.
  const cardAlpha = document.createElement("div");
  cardAlpha.className = "card-alpha";
  cardAlpha.hidden = true;
  card.append(cardType, cardReading, cardMain, cardEnglish, cardGloss, cardAlpha);

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
  // Sound-source options come from the active library: word decks offer
  // Kanji/Hiragana; the kanji schema offers On'yomi/Kun'yomi/Both. Each button's
  // `value` is what we persist per card in state.ttsSources.
  const soundSources = activeLibrary().soundSources || [];
  ttsSource.dataset.count = String(soundSources.length);
  const ttsButtons = soundSources.map((opt) => {
    const btn = button(opt.label, "tts-option");
    btn.dataset.value = opt.value;
    btn.addEventListener("click", () => setTtsSource(opt.value));
    return btn;
  });
  ttsSource.append(...ttsButtons);
  // Sound-source toggle + picker read as one control, so keep them grouped.
  const ttsGroup = document.createElement("div");
  ttsGroup.className = "tts-group";
  ttsGroup.append(ttsToggleBtn, ttsSource);
  // The tray source picker is for "card"-scope schemas (a per-card choice). Hide
  // it when the library has no sound source (Spanish) or its source is a standing
  // "library"-scope setting that lives in Settings instead (kanji).
  ttsGroup.hidden = !activeLibrary().features.soundSource || activeLibrary().soundSourceScope === "library";
  const playBtn = button("Autoplay", "mini mini--play");
  playBtn.innerHTML = `<span class="icon">${ICONS.play}</span>`;
  playBtn.setAttribute("aria-label", "Start autoplay");
  const shuffleBtn = button("Shuffle", "mini mini--shuffle");
  shuffleBtn.innerHTML = "⇄";
  shuffleBtn.setAttribute("aria-label", "Shuffle current set");
  trayMini.append(ttsGroup, playBtn, shuffleBtn);

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
  chooseDeckBtn.addEventListener("click", () => openOverlay("decks"));
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

  // The spoken text for a given sound-source value: each option names the entry
  // fields it reads. Each field's value is a 、-separated reading list; we strip
  // the okurigana parens (やす（む）→ やすむ) and, per the "read all readings"
  // setting, keep either just the first (most common) or every reading. Selected
  // fields are joined with 、 (so "Both" says 音 then 訓). Plain word fields (no
  // 、, no parens) pass through unchanged either way.
  function readingForms(value) {
    const forms = String(value || "").split("、").map((form) => form.replace(/[()（）]/g, "").trim()).filter(Boolean);
    return state.voiceAllReadings ? forms : forms.slice(0, 1);
  }
  function speechForSource(entry, value) {
    const opt = soundSources.find((o) => o.value === value);
    if (!opt) return "";
    return opt.keys.flatMap((key) => readingForms(text(entry, key))).join("、");
  }

  // The system default sound source for an entry. Japanese words: browser TTS
  // mis-reads counter/numeral kanji (十六匹 → ひき not ぴき), so those default to
  // the curated reading, everything else to the kanji form. Other schemas: the
  // first option that yields non-empty speech (e.g. kanji → on'yomi, or kun'yomi
  // when there is no on'yomi). The user can override per card (see setTtsSource).
  function defaultTtsSource(entry) {
    const library = activeLibrary();
    if (library.id === "japanese") {
      return entry?.type === "counter" || entry?.type === "numeral" ? "hiragana" : "kanji";
    }
    for (const opt of soundSources) if (speechForSource(entry, opt.value)) return opt.value;
    return soundSources[0]?.value || "";
  }

  // Effective source. "library" scope: the standing setting (state.soundSource),
  // falling back to the first option — same for every card. "card" scope: the
  // user's saved per-card override if still valid, else the system default.
  function getCurrentTtsSource() {
    const values = soundSources.map((o) => o.value);
    if (activeLibrary().soundSourceScope === "library") {
      return values.includes(state.soundSource) ? state.soundSource : (values[0] || "");
    }
    const entry = currentEntry();
    const saved = state.ttsSources[entryKey(entry)];
    return values.includes(saved) ? saved : defaultTtsSource(entry);
  }

  // The text to speak for an entry. If the schema declares sound sources, speak
  // the chosen one — e.g. the Farsi alphabet/harakat speak the Persian NAME
  // (name_fa), not the carrier glyph; Farsi words speak the vocalized form.
  // (features.soundSource only gates the per-card tray picker, not TTS itself.)
  // Schemas with no sound sources (Spanish) just speak the primary form.
  function studySpeechText(entry) {
    if (soundSources.length) {
      return speechForSource(entry, getCurrentTtsSource()) || primaryText(entry);
    }
    return primaryText(entry) || readingText(entry) || translationText(entry);
  }

  function speakStudy() {
    const value = studySpeechText(currentEntry());
    if (value) speak(value, { lang: activeLibrary().tts.lang, voiceName: state.voice, rate: state.voiceRate });
  }

  function renderTray() {
    const entry = currentEntry();
    const source = getCurrentTtsSource();
    tray.classList.toggle("tts-collapsed", !ttsExpanded);
    ttsToggleBtn.setAttribute("aria-expanded", ttsExpanded ? "true" : "false");
    ttsToggleBtn.disabled = !entry;
    ttsSource.dataset.selected = source;
    for (const btn of ttsButtons) {
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
    playBtn.disabled = !entry;
  }

  function renderCard() {
    const entry = currentEntry();
    const total = setCards.length;
    const deck = currentDeck();
    empty.hidden = total > 0;
    card.hidden = total === 0;
    tray.hidden = total === 0;
    const filter = String(state.query || "").trim();
    // The set is shown by the Set selector above, so it's omitted here.
    summaryMain.textContent = deck
      ? `${deckBreadcrumb(deck)}${filter ? ` · filter “${filter}”` : ""}`
      : "";
    summaryGrouping.textContent = deck ? activeSetGrouping(state.setGrouping).shortLabel : "";
    prevBtn.disabled = total <= 1;
    nextBtn.disabled = total <= 1;
    setSelect.disabled = total === 0;
    if (!entry) {
      const noDeck = !deck;
      emptyMsg.textContent = noDeck
        ? "No deck selected."
        : (bundle ? "No cards match this deck or filter." : "Loading cards...");
      chooseDeckBtn.hidden = !noDeck;
      return;
    }
    // Font CSS vars are shared by both schemas; the kanji card reuses the kanji
    // font for the character and the reading font for the on/kun lines.
    card.style.setProperty("--japanese-main-font-size", `${state.kanjiFontPx}px`);
    card.style.setProperty("--japanese-reading-font-size", `${state.hiraganaFontPx}px`);
    card.style.setProperty("--japanese-english-font-size", `${state.englishFontPx}px`);
    card.style.setProperty("--japanese-gloss-font-size", `${state.glossFontPx}px`);
    card.style.setProperty("--japanese-main-font-family", fontStack(state.kanjiFont));
    card.style.setProperty("--japanese-reading-font-family", fontStack(state.hiraganaFont));
    card.style.setProperty("--japanese-main-font-weight", state.kanjiBold ? "700" : "400");
    card.style.setProperty("--japanese-reading-font-weight", state.hiraganaBold ? "700" : "400");
    // The active mode's `slot` is the field shown on the FRONT (question side);
    // once revealed / in show-all every present field shows, gated by the
    // per-field visibility toggles.
    const frontSlot = (MODES.find((m) => m.id === state.mode) || {}).slot;
    const showFront = revealed || state.mode === "show-all";
    if (schemaIsAlpha) renderFarsiAlphaSlots(entry, frontSlot, showFront);
    else if (schemaIsHarakat) renderFarsiHarakatSlots(entry, frontSlot, showFront);
    else if (schemaIsKanji) renderKanjiSlots(entry, frontSlot, showFront);
    else renderWordSlots(entry, frontSlot, showFront);
    revealBtn.querySelector(".icon").innerHTML = revealed ? ICONS.eyeOff : ICONS.eye;
    revealBtn.setAttribute("aria-label", revealed ? "Hide answer" : "Reveal answer");
    renderTray();
  }

  // --- Word card (Japanese words, Spanish) --------------------------------
  function renderWordSlots(entry, frontSlot, showFront) {
    const primary = primaryText(entry);
    const reading = readingText(entry);
    const translation = translationText(entry);
    const type = typeText(entry);
    // RTL languages (Farsi): the script slots read right-to-left. The translation
    // (English) and type (romanization) stay LTR Latin, so only flip the script
    // slots. Vocalized (reading) shows at full emphasis — see .rtl-schema CSS.
    cardMain.dir = rtl ? "rtl" : "ltr";
    cardReading.dir = rtl ? "rtl" : "ltr";
    const mainText = primary || reading || "-";
    cardType.textContent = type;
    cardMain.textContent = mainText;
    cardReading.textContent = reading;
    cardEnglish.textContent = translation;
    setSlotVisible(cardType, state.visible.type && !!type);
    setSlotVisible(cardMain, (showFront ? state.visible.kanji : frontSlot === "primary") && !!mainText);
    setSlotVisible(cardReading, (showFront ? state.visible.hiragana : frontSlot === "reading") && !!reading);
    setSlotVisible(cardEnglish, (showFront ? state.visible.english : frontSlot === "translation") && !!translation);
    // Gloss: top-right, one line per kanji. Only for libraries with the gloss
    // feature, when the entry has a gloss and the answer is visible.
    const segments = activeLibrary().features.gloss ? glossSegments(glossText(entry)) : [];
    cardGloss.replaceChildren(...segments.map((segment) => {
      const kanji = glossKanji(segment);
      const line = document.createElement("button");
      line.type = "button";
      line.className = "card-gloss-line";
      line.textContent = segment;
      line.setAttribute("aria-label", `Find words with ${kanji}`);
      line.addEventListener("click", () => openGlossMenu(kanji, segment, line));
      return line;
    }));
    setSlotVisible(cardGloss, state.showGloss && showFront && segments.length > 0);
  }

  // --- Kanji card (Japanese Kanji schema) ---------------------------------
  // Same five slots, different content: the character (primary), on/kun reading
  // lines (reading), the meaning (translation), strokes·grade (type), and the
  // radical + components in the tap-menu gloss area. Radical/components and
  // strokes are answer-side (shown with the rest on reveal / show-all).
  function readingLine(tag, value) {
    const line = document.createElement("div");
    line.className = "card-reading-line";
    const t = document.createElement("span");
    t.className = "card-reading-tag";
    t.textContent = tag;
    const v = document.createElement("span");
    v.className = "card-reading-val";
    v.textContent = value;
    line.append(t, v);
    return line;
  }
  // A tappable radical/component chip → the same filter menu the word gloss uses
  // (filter this deck / the Kanji deck by that character).
  function glossChip(label, char, gloss) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "card-gloss-line";
    el.textContent = label;
    el.setAttribute("aria-label", `Find kanji with ${char}`);
    el.addEventListener("click", () => openGlossMenu(char, gloss, el));
    return el;
  }
  // --- Farsi alphabet card -------------------------------------------------
  // Letter (primary), its name (Persian name_fa = reading + spoken, romanized
  // name = translation), index in the type line, and a four-cell positional-
  // forms table (isolated/initial/medial/final) in the breakdown area.
  // A bare positional-form bubble — just the glyph (no label; the position/mode
  // implies which form it is). Non-joining letters show a — dash.
  function formCell(value) {
    const cell = document.createElement("div");
    cell.className = "card-form-cell";
    const glyph = document.createElement("div");
    glyph.className = "card-form-glyph";
    glyph.textContent = value || "—";
    glyph.classList.toggle("card-form-empty", !value);
    cell.append(glyph);
    return cell;
  }
  // Each displayable element is its own mode-addressable field: Letter (isolated),
  // Name (Farsi), Name (English), and the three connecting forms. The active mode
  // shows just that element on the front; reveal / Show All shows everything.
  function renderFarsiAlphaSlots(entry, frontSlot, showFront) {
    for (const slot of [cardType, cardReading, cardMain, cardEnglish, cardGloss]) setSlotVisible(slot, false);
    cardAlpha.hidden = false;

    const index = text(entry, "index");
    const vis = (modeId) => (showFront || state.mode === modeId) ? "visible" : "hidden";
    const elt = (cls, value, rtl) => {
      const node = document.createElement("div");
      node.className = cls;
      if (rtl) node.dir = "rtl";
      node.textContent = value;
      return node;
    };

    // index → top-left; romanized name → top-right corner (rarely read); the
    // letter + forms are the centered focus; the Farsi name sits at the bottom
    // (the "below the line" spot, like the Japanese meaning). idx/rom/fa are
    // absolutely positioned (out of the centered flow).
    const idx = elt("card-alpha-index", index ? `${index} / 34` : "");
    const rom = elt("card-alpha-rom", text(entry, "name"));
    rom.style.visibility = vis("name-en");

    const base = text(entry, "isolated");
    const hero = elt("card-alpha-hero", base || "-", true);
    hero.style.visibility = vis("letter");

    // Forms row: initial · medial · final (no isolated — that's the hero above).
    const row = document.createElement("div");
    row.className = "card-form-row";
    row.dir = "rtl";
    const ci = formCell(text(entry, "initial"));
    const cm = formCell(text(entry, "medial"));
    const cf = formCell(text(entry, "final"));
    ci.style.visibility = vis("initial");
    cm.style.visibility = vis("medial");
    cf.style.visibility = vis("final");
    // Each form bubble taps through to the Farsi Words, filtered to this letter
    // in that position (initial/medial/final). The base letter is the same for
    // all forms — the form just picks the word-position to search.
    if (base) {
      for (const [cell, form] of [[ci, "initial"], [cm, "medial"], [cf, "final"]]) {
        cell.classList.add("card-form-tap");
        cell.addEventListener("click", () => openFormMenu(base, form, cell));
      }
    }
    row.append(ci, cm, cf);

    const fa = elt("card-alpha-fa", text(entry, "name_fa"), true);
    fa.style.visibility = vis("name-fa");

    cardAlpha.replaceChildren(idx, rom, hero, row, fa);
  }

  // --- Farsi harakat card --------------------------------------------------
  // Same canvas as the alphabet: index (top-left), romanized name (top-right),
  // the mark on its carrier (hero), and the Farsi name + effect at the bottom.
  // The "forms row" slot instead holds usage examples (the mark in use + romaji).
  function exampleCell(glyph, rom) {
    const cell = document.createElement("div");
    cell.className = "card-form-cell card-ex-cell";
    const g = document.createElement("div");
    g.className = "card-form-glyph";
    g.dir = "rtl";
    g.textContent = glyph;
    const r = document.createElement("div");
    r.className = "card-ex-rom";
    r.textContent = rom;
    cell.append(g, r);
    return cell;
  }
  function renderFarsiHarakatSlots(entry, frontSlot, showFront) {
    for (const slot of [cardType, cardReading, cardMain, cardEnglish, cardGloss]) setSlotVisible(slot, false);
    cardAlpha.hidden = false;

    const index = text(entry, "index");
    const vis = (modeId) => (showFront || state.mode === modeId) ? "visible" : "hidden";
    const elt = (cls, value, rtl) => {
      const node = document.createElement("div");
      node.className = cls;
      if (rtl) node.dir = "rtl";
      node.textContent = value;
      return node;
    };

    const idx = elt("card-alpha-index", index ? `${index} / 6` : "");
    const rom = elt("card-alpha-rom", text(entry, "name"));
    rom.style.visibility = vis("name-en");

    const hero = elt("card-alpha-hero", text(entry, "mark") || "-", true);
    hero.style.visibility = vis("mark");

    // Examples row (reference; shown on reveal / show-all). Each = glyph + romaji.
    const row = document.createElement("div");
    row.className = "card-form-row";
    row.dir = "rtl";
    const examples = [["ex1", "ex1_rom"], ["ex2", "ex2_rom"], ["ex3", "ex3_rom"], ["ex4", "ex4_rom"]]
      .map(([g, r]) => [text(entry, g), text(entry, r)])
      .filter(([g]) => g);
    for (const [glyph, romaji] of examples) row.append(exampleCell(glyph, romaji));
    row.style.visibility = showFront ? "visible" : "hidden";

    // Bottom band: Farsi name (large) + effect (muted), each mode-toggleable.
    const bottom = document.createElement("div");
    bottom.className = "card-alpha-bottom";
    const fa = elt("card-alpha-fa-inline", text(entry, "name_fa"), true);
    fa.style.visibility = vis("name-fa");
    const effect = elt("card-alpha-effect", text(entry, "effect"));
    effect.style.visibility = vis("effect");
    bottom.append(fa, effect);

    cardAlpha.replaceChildren(idx, rom, hero, row, bottom);
  }

  function renderKanjiSlots(entry, frontSlot, showFront) {
    const character = text(entry, "kanji");
    const onyomi = text(entry, "onyomi");
    const kunyomi = text(entry, "kunyomi");
    const meaning = text(entry, "meaning");
    const strokes = text(entry, "strokes");
    const grade = text(entry, "grade");
    const radical = text(entry, "radical");
    const radicalName = text(entry, "radical-name");
    const components = text(entry, "components").split("、").map((part) => part.trim()).filter(Boolean);

    cardMain.textContent = character || "-";
    cardReading.replaceChildren(...[
      onyomi ? readingLine("音", onyomi) : null,
      kunyomi ? readingLine("訓", kunyomi) : null
    ].filter(Boolean));
    cardEnglish.textContent = meaning;
    cardType.textContent = [strokes && `${strokes}画`, grade && `学年${grade}`].filter(Boolean).join(" · ");

    const chips = [];
    if (radical) chips.push(glossChip(`部首 ${radical}${radicalName ? ` ${radicalName}` : ""}`, radical, radicalName));
    for (const component of components) chips.push(glossChip(component, component, ""));
    cardGloss.replaceChildren(...chips);

    setSlotVisible(cardMain, (showFront ? state.visible.kanji : frontSlot === "primary") && !!character);
    setSlotVisible(cardReading, (showFront ? state.visible.hiragana : frontSlot === "reading") && (!!onyomi || !!kunyomi));
    setSlotVisible(cardEnglish, (showFront ? state.visible.english : frontSlot === "translation") && !!meaning);
    setSlotVisible(cardType, showFront && state.visible.type && !!cardType.textContent);
    setSlotVisible(cardGloss, showFront && chips.length > 0);
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

  // --- Kanji gloss tap menu -----------------------------------------------
  // Tapping a gloss line offers to find other words with that kanji — either by
  // filtering the current deck in place, or via the deck selector (which carries
  // the filter, letting the user switch to All decks or any other deck).
  let glossMenu = null;
  function closeGlossMenu() {
    if (!glossMenu) return;
    document.removeEventListener("keydown", glossMenu.onKey, true);
    window.removeEventListener("popstate", closeGlossMenu);
    glossMenu.backdrop.remove();
    glossMenu.menu.remove();
    glossMenu = null;
  }
  function applyKanjiFilter(kanji) {
    state.query = kanji;
    state.setId = "all";
    state.currentIndex = 0;
    saveState(state);
  }

  // The top-level "root deck" containing the current selection — the first
  // category segment, as a folder target (e.g. "Texts" → "folder:Texts").
  // null when nothing is selected, on "All decks", or when the current target
  // already IS that root (so the gloss menu doesn't offer a redundant option).
  function currentDeckRoot() {
    const id = state.deckId;
    if (!id || id === "all") return null;
    const segments = id.startsWith("folder:")
      ? id.slice("folder:".length).split("/")
      : String(currentDeck()?.category || "").split("/");
    const root = segments.map((part) => part.trim()).filter(Boolean)[0];
    if (!root || `folder:${root}` === id) return null;
    return { id: `folder:${root}`, label: root };
  }
  function openGlossMenu(kanji, glossText, anchor) {
    closeGlossMenu();
    const backdrop = document.createElement("div");
    backdrop.className = "gloss-menu-backdrop";
    const menu = document.createElement("div");
    menu.className = "gloss-menu";
    menu.setAttribute("role", "menu");

    const head = document.createElement("div");
    head.className = "gloss-menu-head";
    const kanjiEl = document.createElement("span");
    kanjiEl.className = "gloss-menu-kanji";
    kanjiEl.textContent = kanji;
    const glossEl = document.createElement("span");
    glossEl.className = "gloss-menu-gloss";
    glossEl.textContent = glossText.replace(/^[^:：]*[:：]\s*/, "");
    head.append(kanjiEl, glossEl);

    const filterBtn = document.createElement("button");
    filterBtn.type = "button";
    filterBtn.className = "gloss-menu-item";
    filterBtn.textContent = `Filter this deck by ${kanji}`;
    // Middle option: filter the whole root deck (the top-level folder) in place,
    // a quick widen-the-net step without opening the deck selector.
    const root = currentDeckRoot();
    let rootBtn = null;
    if (root) {
      rootBtn = document.createElement("button");
      rootBtn.type = "button";
      rootBtn.className = "gloss-menu-item";
      rootBtn.textContent = `Filter ${root.label} deck by ${kanji}`;
    }
    const chooseBtn = document.createElement("button");
    chooseBtn.type = "button";
    chooseBtn.className = "gloss-menu-item";
    chooseBtn.textContent = `Find ${kanji} in another deck…`;
    menu.append(head, filterBtn, ...(rootBtn ? [rootBtn] : []), chooseBtn);
    document.body.append(backdrop, menu);

    // Position below the tapped line, clamped to the viewport; flip above if it
    // would overflow the bottom.
    const r = anchor.getBoundingClientRect();
    const mw = menu.offsetWidth;
    const mh = menu.offsetHeight;
    const left = Math.max(8, Math.min(r.right - mw, window.innerWidth - mw - 8));
    let top = r.bottom + 6;
    if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 6);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;

    const onKey = (event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); closeGlossMenu(); }
    };
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("popstate", closeGlossMenu);
    glossMenu = { backdrop, menu, onKey };

    backdrop.addEventListener("click", closeGlossMenu);
    // Filter in place: a new (deck, filter) is a back entry only once the prior
    // one was studied long enough (same gate as the filter history).
    filterBtn.addEventListener("click", async () => {
      const remember = sessionQualifies();
      closeGlossMenu();
      endSession();
      applyKanjiFilter(kanji);
      await renderAll();
      const deck = currentDeck();
      beginSession(state.deckId, deck ? deck.label : "", state.query);
      remember ? pushCardsURL() : replaceCardsURL();
    });
    // Switch to the root deck and apply the filter, in place (no deck picker).
    if (rootBtn) {
      rootBtn.addEventListener("click", async () => {
        const remember = sessionQualifies();
        closeGlossMenu();
        endSession();
        state.deckId = root.id;
        applyKanjiFilter(kanji);
        await renderAll();
        const deck = currentDeck();
        beginSession(state.deckId, deck ? deck.label : "", state.query);
        remember ? pushCardsURL() : replaceCardsURL();
      });
    }
    // Same filter, then open the deck picker (carrying it) to switch decks.
    chooseBtn.addEventListener("click", () => {
      const remember = sessionQualifies();
      closeGlossMenu();
      applyKanjiFilter(kanji);
      remember ? pushCardsURL() : replaceCardsURL();
      openOverlay("decks");
    });
    filterBtn.focus();
  }

  // Farsi alphabet: tap a letter form → jump to the Farsi Words, filtered to that
  // letter in the matching word position. Forms aren't stored in the text (Arabic
  // shaping is presentational), so we search the BASE letter with a position-
  // anchored quoted query (see matchesQuery): initial→starts, final→ends,
  // isolated→exact, medial→anywhere.
  const FORM_FILTERS = {
    isolated: { name: "isolated", query: (c) => `" ${c} "`, label: (c) => `Words that are just ${c}` },
    initial: { name: "initial", query: (c) => `" ${c}"`, label: (c) => `Words starting with ${c}` },
    medial: { name: "medial", query: (c) => `"${c}"`, label: (c) => `Words with ${c} anywhere` },
    final: { name: "final", query: (c) => `"${c} "`, label: (c) => `Words ending with ${c}` }
  };
  function openFormMenu(baseChar, formId, anchor) {
    closeGlossMenu();
    const spec = FORM_FILTERS[formId] || FORM_FILTERS.isolated;
    const backdrop = document.createElement("div");
    backdrop.className = "gloss-menu-backdrop";
    const menu = document.createElement("div");
    menu.className = "gloss-menu";
    menu.setAttribute("role", "menu");

    const head = document.createElement("div");
    head.className = "gloss-menu-head";
    const charEl = document.createElement("span");
    charEl.className = "gloss-menu-kanji";
    charEl.dir = "rtl";
    charEl.textContent = baseChar;
    const formEl = document.createElement("span");
    formEl.className = "gloss-menu-gloss";
    formEl.textContent = `${spec.name} form`;
    head.append(charEl, formEl);

    // Primary: the position filter for this form. Secondary (except for medial,
    // which already is "anywhere"): the broaden-to-anywhere option.
    const items = [{ q: spec.query(baseChar), label: spec.label(baseChar) }];
    if (formId !== "medial") items.push({ q: `"${baseChar}"`, label: `Words with ${baseChar} anywhere` });

    menu.append(head);
    const buttons = items.map((item) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "gloss-menu-item";
      btn.textContent = item.label;
      btn.addEventListener("click", () => {
        closeGlossMenu();
        endSession();
        filterInLibrary("farsi", "folder:Words", item.q);
      });
      menu.append(btn);
      return btn;
    });
    document.body.append(backdrop, menu);

    const r = anchor.getBoundingClientRect();
    const mw = menu.offsetWidth;
    const mh = menu.offsetHeight;
    const left = Math.max(8, Math.min(r.right - mw, window.innerWidth - mw - 8));
    let top = r.bottom + 6;
    if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 6);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;

    const onKey = (event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); closeGlossMenu(); }
    };
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("popstate", closeGlossMenu);
    glossMenu = { backdrop, menu, onKey };
    backdrop.addEventListener("click", closeGlossMenu);
    buttons[0].focus();
  }

  // --- Interactions -------------------------------------------------------
  function move(delta) {
    if (!setCards.length) return;
    state.currentIndex = (state.currentIndex + delta + setCards.length) % setCards.length;
    revealed = false;
    saveState(state);
    renderCard();
    if (state.mode === "voice") speakStudy();
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
    if (state.mode === "voice") speakStudy();
  }

  function reveal() {
    if (!currentEntry()) return;
    revealed = !revealed;
    renderCard();
    if (revealed) speakStudy();
  }

  // --- Autoplay -----------------------------------------------------------
  // Loops: advance to the next card, wait the "question" delay, reveal the
  // answer, wait the "answer" delay, repeat. Any real user gesture stops it
  // (see the capture-phase listeners below); autoplay's own move()/reveal()
  // calls are programmatic and never dispatch those events.
  //
  // The configured delays are gaps that begin once speech is expected to be
  // done. Browser TTS exposes no reliable "finished" signal (onend is flaky;
  // `speaking` can stay stuck true), so when "estimate TTS delay" is on we add
  // an estimated speak duration (reading length × MS_PER_KANA) to a phase that
  // speaks — the answer always, the question in voice mode. So a long word gets
  // proportionally more time before advancing. Stopping bumps autoplayToken,
  // which invalidates every pending sleep so in-flight cycles unwind.
  function reflectAutoplay() {
    playBtn.classList.toggle("active", autoplaying);
    playBtn.querySelector(".icon").innerHTML = autoplaying ? ICONS.pause : ICONS.play;
    playBtn.setAttribute("aria-pressed", autoplaying ? "true" : "false");
    playBtn.setAttribute("aria-label", autoplaying ? "Stop autoplay" : "Start autoplay");
  }

  function stopAutoplay() {
    if (!autoplaying) return;
    autoplaying = false;
    autoplayToken += 1; // invalidate any pending sleep/poll
    cancelAutoplaySleep(); // clear the pending timer and settle its promise now
    reflectAutoplay();
  }

  // The single in-flight sleep timer (the cycle awaits one at a time). Tracked
  // so stop/teardown can clear it instead of letting it fire into a dead state.
  let sleepTimer = null;
  let sleepResolve = null;
  function cancelAutoplaySleep() {
    if (sleepTimer !== null) { clearTimeout(sleepTimer); sleepTimer = null; }
    if (sleepResolve) { const r = sleepResolve; sleepResolve = null; r(false); }
  }

  // Resolves true after `ms`, or false if autoplay was stopped/superseded.
  function autoplaySleep(ms, token) {
    return new Promise((resolve) => {
      sleepResolve = resolve;
      sleepTimer = setTimeout(() => {
        sleepTimer = null;
        sleepResolve = null;
        resolve(autoplaying && token === autoplayToken);
      }, Math.max(0, ms));
    });
  }

  // Rough estimate of how long the current card takes to speak, using the
  // active library's estimate config (which field to count + ms per char):
  // Japanese counts reading morae (~200ms each); Spanish counts word characters
  // (~75ms each, since Latin letters run faster than morae).
  function estimatedSpeechMs(entry) {
    const est = activeLibrary().tts.estimate || { source: "primary", msPerUnit: 200 };
    const value = est.source === "reading" ? (readingText(entry) || studySpeechText(entry)) : studySpeechText(entry);
    return [...value].length * est.msPerUnit;
  }

  // Wait the configured delay, plus an estimated speak time if this phase spoke
  // and the estimate is enabled. Returns false if autoplay was stopped.
  function autoplaySettle(spoke, delaySec, token) {
    let ms = Math.max(0, delaySec) * 1000;
    if (spoke && state.autoplayEstimateTts) ms += estimatedSpeechMs(currentEntry());
    return autoplaySleep(ms, token);
  }

  async function autoplayCycle() {
    const token = autoplayToken;
    const live = () => autoplaying && token === autoplayToken && root.isConnected && setCards.length > 0;
    while (live()) {
      move(1); // next card, fresh question (speaks in voice mode)
      if (!(await autoplaySettle(state.mode === "voice", state.autoplayQuestionDelay, token))) return;
      if (!live()) return;
      if (!revealed) reveal(); // show + speak the answer
      const spokeAnswer = !!studySpeechText(currentEntry());
      if (!(await autoplaySettle(spokeAnswer, state.autoplayAnswerDelay, token))) return;
    }
  }

  function toggleAutoplay() {
    if (autoplaying) { stopAutoplay(); return; }
    if (!setCards.length) return;
    autoplaying = true;
    autoplayToken += 1;
    reflectAutoplay();
    void autoplayCycle();
  }

  function setTtsSource(value) {
    const entry = currentEntry();
    const key = entryKey(entry);
    if (!key || !soundSources.some((o) => o.value === value)) return;
    // Persist only a deviation from the system default; choosing the default
    // clears any prior override so the card falls back to it.
    if (value === defaultTtsSource(entry)) delete state.ttsSources[key];
    else state.ttsSources[key] = value;
    saveState(state);
    renderTray();
    speakStudy();
  }

  deckButton.addEventListener("click", () => openOverlay("decks"));
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
    if (state.mode === "voice") speakStudy();
  });
  settingsBtn.addEventListener("click", () => openOverlay("settings"));
  libraryBtn.addEventListener("click", () => openOverlay("library"));
  ttsToggleBtn.addEventListener("click", () => {
    ttsExpanded = !ttsExpanded;
    state.audioSourceExpanded = ttsExpanded;
    saveState(state);
    renderTray();
  });
  shuffleBtn.addEventListener("click", shuffleCurrentSet);
  playBtn.addEventListener("click", toggleAutoplay);
  prevBtn.addEventListener("click", () => move(-1));
  nextBtn.addEventListener("click", () => move(1));
  revealBtn.addEventListener("click", reveal);
  soundBtn.addEventListener("click", speakStudy);
  chatgptBtn.addEventListener("click", () => openSearchLink(LINK_TEMPLATES.chatgpt, currentEntry()));
  imagesBtn.addEventListener("click", () => openSearchLink(LINK_TEMPLATES.googleImages, currentEntry()));

  // Any real user gesture (except on the play button itself) stops autoplay.
  // Capture phase so it fires before the control's own handler. Autoplay's
  // programmatic move()/reveal() don't dispatch these, so they never self-stop.
  // Only an actual interactive control stops autoplay — clicking bare card area
  // (or empty tray space) leaves it running. The play button toggles itself.
  const INTERACTIVE = 'button, a[href], select, input, textarea, [role="button"]';
  function onUserGesture(event) {
    if (!autoplaying) return;
    const control = event.target?.closest?.(INTERACTIVE);
    if (!control || playBtn.contains(control)) return;
    stopAutoplay();
  }
  root.addEventListener("pointerdown", onUserGesture, true);
  root.addEventListener("click", onUserGesture, true);
  root.addEventListener("change", onUserGesture, true);

  function onKeydown(event) {
    if (!root.isConnected) { document.removeEventListener("keydown", onKeydown); return; }
    const tag = String(event.target?.tagName || "").toLowerCase();
    if (["input", "select", "textarea"].includes(tag) || event.target?.isContentEditable) return;
    stopAutoplay();
    if (event.key === "ArrowLeft") { event.preventDefault(); move(-1); }
    else if (event.key === "ArrowRight") { event.preventDefault(); move(1); }
    else if (event.key === " " || event.key === "Enter") { event.preventDefault(); reveal(); }
    else if (event.key.toLowerCase() === "s") { event.preventDefault(); speakStudy(); }
  }
  document.addEventListener("keydown", onKeydown);

  async function initialize() {
    try {
      bundle = await loadBundle();
      await renderAll({ keepIndex: true });
      // Start timing this study session (deck + active filter) for history.
      const deck = currentDeck();
      beginSession(state.deckId, deck ? deck.label : "", state.query);
      if (state.mode === "voice") speakStudy();
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
