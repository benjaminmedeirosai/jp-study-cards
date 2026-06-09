import { activeSetGrouping, computeDeckSets } from "./sets.js";
import { speak, getVoicesForLang, onVoicesChanged } from "./speech.js";

const VOICE_SAMPLE = "こんにちは。これは音声のプレビューです。";
import {
  DEFAULT_SET_SIZE,
  VOICE_RATE_OPTIONS,
  SET_GROUPINGS,
  clampInt,
  normalizeSetGrouping,
  loadState,
  saveState,
  text,
  searchText,
  loadBundle,
  resolveDeck,
  button,
  fieldLabel,
  makeSelect,
  makeToggle
} from "./shared.js";

function goToCards() {
  location.hash = "#/";
}

// A divider + label that opens a group of related settings.
function sectionHeading(label) {
  const heading = document.createElement("div");
  heading.className = "settings-section";
  heading.textContent = label;
  return heading;
}

// Resolve and load the cards of the currently-selected deck, for the live preview.
async function loadActiveDeckCards(state) {
  const bundle = await loadBundle();
  const deck = resolveDeck(bundle, state.deckId);
  return deck ? deck.entries : [];
}

export function renderSettingsPage() {
  const state = loadState();

  const root = document.createElement("section");
  root.className = "study-page settings-page";

  const top = document.createElement("header");
  top.className = "settings-top";
  const backBtn = button("Back", "settings-back", "←");
  backBtn.setAttribute("aria-label", "Back to cards");
  const title = document.createElement("h1");
  title.className = "settings-title";
  title.textContent = "Settings";
  top.append(backBtn, title);

  const form = document.createElement("form");
  form.className = "settings-form";
  const content = document.createElement("div");
  content.className = "settings-content";

  // --- Filter -------------------------------------------------------------
  const queryInput = document.createElement("input");
  queryInput.placeholder = "filter";
  queryInput.value = state.query;
  queryInput.autocomplete = "off";
  const queryField = fieldLabel("Filter", queryInput, "filter-field");
  const queryText = queryField.querySelector("span");

  // --- Set size / grouping ------------------------------------------------
  const setSizeInput = document.createElement("input");
  setSizeInput.type = "number";
  setSizeInput.min = "5";
  setSizeInput.max = "100";
  setSizeInput.step = "5";
  setSizeInput.value = String(state.setSize);
  const setGroupingInput = makeSelect(
    SET_GROUPINGS.map((grouping) => ({ value: grouping.id, label: grouping.label })),
    state.setGrouping
  );

  // --- Font scales (sliders, 50–150% in 5% steps) ------------------------
  const FONT_MIN = 50;
  const FONT_MAX = 150;
  function makeFontSlider(value) {
    const input = document.createElement("input");
    input.type = "range";
    input.className = "font-slider";
    input.min = String(FONT_MIN);
    input.max = String(FONT_MAX);
    input.step = "5";
    input.value = String(clampInt(value, FONT_MAX, FONT_MIN, FONT_MAX));
    return input;
  }
  const kanjiFontInput = makeFontSlider(state.kanjiFontScale);
  const hiraganaFontInput = makeFontSlider(state.hiraganaFontScale);
  const englishFontInput = makeFontSlider(state.englishFontScale);
  const glossFontInput = makeFontSlider(state.glossFontScale);
  const hotkeyToggle = makeToggle("Hotkeys", state.showHotkeys);
  const glossToggle = makeToggle("Kanji gloss", state.showGloss);

  // --- Japanese voice (Web Speech API voices for ja-*) --------------------
  const voiceSelect = document.createElement("select");
  function populateVoices() {
    const desired = voiceSelect.options.length ? voiceSelect.value : state.jpVoice;
    voiceSelect.innerHTML = "";
    const items = [{ value: "", label: "Auto (device default)" }];
    for (const voice of getVoicesForLang("ja")) items.push({ value: voice.name, label: `${voice.name} · ${voice.lang}` });
    for (const item of items) {
      const option = document.createElement("option");
      option.value = item.value;
      option.textContent = item.label;
      voiceSelect.append(option);
    }
    voiceSelect.value = items.some((item) => item.value === desired) ? desired : "";
  }
  populateVoices();
  // Voices often arrive asynchronously; repopulate when they do.
  const offVoices = onVoicesChanged(() => {
    if (!root.isConnected) { offVoices(); return; }
    populateVoices();
  });
  const rateSelect = makeSelect(
    VOICE_RATE_OPTIONS.map((rate) => ({ value: String(rate), label: `${rate}×` })),
    String(state.voiceRate)
  );

  const voicePreviewBtn = document.createElement("button");
  voicePreviewBtn.type = "button";
  voicePreviewBtn.className = "voice-preview";
  voicePreviewBtn.setAttribute("aria-label", "Preview voice");
  voicePreviewBtn.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5l12 7-12 7z"/></svg><span>Preview</span>`;
  voicePreviewBtn.addEventListener("click", () => speak(VOICE_SAMPLE, { lang: "ja-JP", voiceName: voiceSelect.value, rate: Number(rateSelect.value) }));
  const voiceRow = document.createElement("div");
  voiceRow.className = "voice-row";
  voiceRow.append(voiceSelect, voicePreviewBtn);

  // --- Live set preview ---------------------------------------------------
  const setPreview = document.createElement("div");
  setPreview.className = "set-preview";
  const setPreviewTitle = document.createElement("div");
  setPreviewTitle.className = "set-preview-title";
  setPreviewTitle.textContent = "Set preview";
  const setPreviewNote = document.createElement("div");
  setPreviewNote.className = "set-preview-note";
  const setPreviewRows = document.createElement("div");
  setPreviewRows.className = "set-preview-rows";
  setPreview.append(setPreviewTitle, setPreviewNote, setPreviewRows);

  let previewBaseCards = [];
  let cardsLoaded = false;
  void loadActiveDeckCards(state)
    .then((cards) => { previewBaseCards = cards; })
    .catch(() => {})
    .finally(() => { cardsLoaded = true; updateSettingsPreview(); });

  function updateFilterCount() {
    const base = previewBaseCards;
    const query = String(queryInput.value || "").trim().toLowerCase();
    const count = query ? base.filter((entry) => searchText(entry).includes(query)).length : base.length;
    if (queryText) queryText.textContent = `Filter ${count}/${base.length} records`;
  }
  function updateSettingsPreview() {
    updateFilterCount();
    // Don't compute until the deck has loaded — computing with an empty card list
    // would both show "0 placements" and evict the card page's shared cache entry.
    if (!cardsLoaded) {
      setPreviewTitle.textContent = "Set preview (loading…)";
      setPreviewNote.hidden = true;
      setPreviewRows.innerHTML = "";
      return;
    }
    const groupingId = normalizeSetGrouping(setGroupingInput.value);
    const grouping = activeSetGrouping(groupingId);
    // Shares the memoized grouping result with the card page (same cacheKey),
    // so opening settings on an already-built deck is a redraw, not a recompute.
    const { deckCards: cards, setOptions: options } = computeDeckSets({
      cacheKey: state.deckId,
      cards: previewBaseCards,
      query: queryInput.value,
      setSize: clampInt(setSizeInput.value, DEFAULT_SET_SIZE, 5, 100),
      groupingId
    });
    setPreviewRows.innerHTML = "";
    const seenCards = new Set();
    let placementCount = 0;
    let duplicateCount = 0;
    for (const option of options) {
      const optionCards = option.cards || cards.slice(option.start, option.end);
      placementCount += optionCards.length;
      for (const card of optionCards) {
        if (seenCards.has(card)) duplicateCount += 1;
        else seenCards.add(card);
      }
      const previewWords = optionCards.map((entry) => text(entry, "kanji") || text(entry, "hiragana") || text(entry, "english")).join(" · ");
      const row = document.createElement("div");
      row.className = "set-preview-row";
      row.setAttribute("aria-label", `${option.label}: ${previewWords}`);
      const label = document.createElement("span");
      label.className = "set-preview-label";
      label.textContent = option.label;
      const words = document.createElement("span");
      words.className = "set-preview-words";
      words.textContent = previewWords;
      row.append(label, words);
      setPreviewRows.append(row);
    }
    setPreviewTitle.textContent = `Set preview (${options.length} sets · ${placementCount} placements)`;
    setPreviewNote.hidden = duplicateCount === 0;
    setPreviewNote.textContent = duplicateCount
      ? `* ${duplicateCount} extra placements: ${grouping.key} likeness grouping can put one word in multiple sets when it matches multiple ${grouping.key} keys.`
      : "";
  }
  // Debounce the heavy preview rebuild so rapid typing doesn't trigger a
  // grouping recompute on every keystroke.
  let previewTimer = 0;
  function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(updateSettingsPreview, 200);
  }
  // Filter is a live, shared setting (persisted to state.query immediately) so
  // it stays in sync with the deck page rather than waiting for Save. The record
  // count updates instantly; the set preview is debounced.
  queryInput.addEventListener("input", () => {
    const next = String(queryInput.value || "").trim();
    if (next !== state.query) {
      state.query = next;
      state.setId = "all";
      state.currentIndex = 0;
      saveState(state);
    }
    updateFilterCount();
    schedulePreview();
  });
  // Set size / grouping change which sets exist, so reset to the first set.
  setSizeInput.addEventListener("input", () => {
    const previous = state.setSize;
    state.setSize = clampInt(setSizeInput.value, DEFAULT_SET_SIZE, 5, 100);
    if (state.setSize !== previous) {
      state.setId = "all";
      state.currentIndex = 0;
    }
    saveState(state);
    updateSettingsPreview();
  });
  setGroupingInput.addEventListener("change", () => {
    const previous = state.setGrouping;
    state.setGrouping = SET_GROUPINGS.some((grouping) => grouping.id === setGroupingInput.value) ? setGroupingInput.value : SET_GROUPINGS[0].id;
    if (state.setGrouping !== previous) {
      state.setId = "all";
      state.currentIndex = 0;
    }
    saveState(state);
    updateSettingsPreview();
  });

  // Font sizes apply immediately; the field label echoes the current percentage.
  const kanjiFontField = fieldLabel(`Kanji size ${state.kanjiFontScale}%`, kanjiFontInput);
  const hiraganaFontField = fieldLabel(`Hiragana size ${state.hiraganaFontScale}%`, hiraganaFontInput);
  const englishFontField = fieldLabel(`English size ${state.englishFontScale}%`, englishFontInput);
  const glossFontField = fieldLabel(`Kanji gloss size ${state.glossFontScale}%`, glossFontInput);
  function wireFontScale(input, field, key, label) {
    input.addEventListener("input", () => {
      state[key] = clampInt(input.value, FONT_MAX, FONT_MIN, FONT_MAX);
      field.querySelector("span").textContent = `${label} size ${state[key]}%`;
      saveState(state);
    });
  }
  wireFontScale(kanjiFontInput, kanjiFontField, "kanjiFontScale", "Kanji");
  wireFontScale(hiraganaFontInput, hiraganaFontField, "hiraganaFontScale", "Hiragana");
  wireFontScale(englishFontInput, englishFontField, "englishFontScale", "English");
  wireFontScale(glossFontInput, glossFontField, "glossFontScale", "Kanji gloss");

  voiceSelect.addEventListener("change", () => {
    state.jpVoice = voiceSelect.value;
    saveState(state);
  });
  rateSelect.addEventListener("change", () => {
    state.voiceRate = Number(rateSelect.value);
    saveState(state);
  });
  hotkeyToggle.input.addEventListener("change", () => {
    state.showHotkeys = hotkeyToggle.input.checked;
    saveState(state);
  });
  glossToggle.input.addEventListener("change", () => {
    state.showGloss = glossToggle.input.checked;
    saveState(state);
  });

  const visibilityGroup = document.createElement("div");
  visibilityGroup.className = "settings-toggle-grid";
  visibilityGroup.append(hotkeyToggle.label, glossToggle.label);

  content.append(
    sectionHeading("Filter & sets"),
    queryField,
    fieldLabel("Set size", setSizeInput),
    fieldLabel("Set grouping", setGroupingInput),
    setPreview,
    sectionHeading("Font sizes"),
    kanjiFontField,
    hiraganaFontField,
    englishFontField,
    glossFontField,
    sectionHeading("Voice & speed"),
    fieldLabel("Japanese voice", voiceRow),
    fieldLabel("Voice speed", rateSelect),
    sectionHeading("Other"),
    visibilityGroup
  );

  form.append(content);
  root.append(top, form);

  updateFilterCount();
  updateSettingsPreview();

  // --- Wiring -------------------------------------------------------------
  backBtn.addEventListener("click", goToCards);
  // Settings apply immediately, so there is nothing to submit.
  form.addEventListener("submit", (event) => event.preventDefault());

  return root;
}
