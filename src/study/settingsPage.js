import { buildSetOptions, sortCardsForSets, activeSetGrouping } from "./sets.js";
import {
  DEFAULT_SET_SIZE,
  FONT_SCALE_OPTIONS,
  SET_GROUPINGS,
  clampInt,
  normalizeSetGrouping,
  loadState,
  saveState,
  text,
  searchText,
  loadIndex,
  loadDeckCards,
  resolveDeck,
  button,
  fieldLabel,
  makeSelect,
  makeToggle
} from "./shared.js";

function goToCards() {
  location.hash = "#/";
}

// Resolve and load the cards of the currently-selected deck, for the live preview.
async function loadActiveDeckCards(state) {
  const index = await loadIndex();
  const deck = resolveDeck(index, state.deckId) || resolveDeck(index, "all");
  return loadDeckCards(deck);
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

  // --- Font scales --------------------------------------------------------
  const fontItems = FONT_SCALE_OPTIONS.map((value) => ({ value: String(value), label: `${value}%` }));
  const kanjiFontInput = makeSelect(fontItems, String(state.kanjiFontScale));
  const hiraganaFontInput = makeSelect(fontItems, String(state.hiraganaFontScale));
  const englishFontInput = makeSelect(fontItems, String(state.englishFontScale));
  const hotkeyToggle = makeToggle("Hotkeys", state.showHotkeys);

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
  void loadActiveDeckCards(state)
    .then((cards) => {
      previewBaseCards = cards;
      updateSettingsPreview();
    })
    .catch(() => {});

  function settingsPreviewCards() {
    const query = String(queryInput.value || "").trim().toLowerCase();
    const matchingCards = query ? previewBaseCards.filter((entry) => searchText(entry).includes(query)) : previewBaseCards;
    return sortCardsForSets(matchingCards, setGroupingInput.value);
  }
  function updateFilterCount() {
    const base = previewBaseCards;
    const query = String(queryInput.value || "").trim().toLowerCase();
    const count = query ? base.filter((entry) => searchText(entry).includes(query)).length : base.length;
    if (queryText) queryText.textContent = `Filter ${count}/${base.length} records`;
  }
  function updateSettingsPreview() {
    updateFilterCount();
    const cards = settingsPreviewCards();
    const groupingId = normalizeSetGrouping(setGroupingInput.value);
    const grouping = activeSetGrouping(groupingId);
    const options = buildSetOptions(cards, clampInt(setSizeInput.value, DEFAULT_SET_SIZE, 5, 100), groupingId);
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
  queryInput.addEventListener("input", updateSettingsPreview);
  setSizeInput.addEventListener("input", updateSettingsPreview);
  setGroupingInput.addEventListener("change", updateSettingsPreview);

  const visibilityGroup = document.createElement("div");
  visibilityGroup.className = "settings-toggle-grid";
  visibilityGroup.append(hotkeyToggle.label);

  content.append(
    queryField,
    fieldLabel("Set size", setSizeInput),
    fieldLabel("Set grouping", setGroupingInput),
    setPreview,
    fieldLabel(`Kanji size ${state.kanjiFontScale}%`, kanjiFontInput),
    fieldLabel(`Hiragana size ${state.hiraganaFontScale}%`, hiraganaFontInput),
    fieldLabel(`English size ${state.englishFontScale}%`, englishFontInput),
    visibilityGroup
  );

  // --- Actions ------------------------------------------------------------
  const actions = document.createElement("div");
  actions.className = "settings-actions";
  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "settings-button";
  cancelBtn.textContent = "Cancel";
  const saveBtn = document.createElement("button");
  saveBtn.type = "submit";
  saveBtn.className = "settings-button primary";
  saveBtn.textContent = "Save";
  actions.append(cancelBtn, saveBtn);

  form.append(content, actions);
  root.append(top, form);

  updateFilterCount();
  updateSettingsPreview();

  // --- Wiring -------------------------------------------------------------
  backBtn.addEventListener("click", goToCards);
  cancelBtn.addEventListener("click", goToCards);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const previousQuery = state.query;
    const previousSetSize = state.setSize;
    const previousSetGrouping = state.setGrouping;
    state.query = String(queryInput.value || "").trim();
    state.setSize = clampInt(setSizeInput.value, DEFAULT_SET_SIZE, 5, 100);
    state.setGrouping = SET_GROUPINGS.some((grouping) => grouping.id === setGroupingInput.value) ? setGroupingInput.value : SET_GROUPINGS[0].id;
    state.kanjiFontScale = clampInt(kanjiFontInput.value, 150, 10, 250);
    state.hiraganaFontScale = clampInt(hiraganaFontInput.value, 150, 10, 250);
    state.englishFontScale = clampInt(englishFontInput.value, 150, 10, 250);
    state.showHotkeys = hotkeyToggle.input.checked;
    const setMembershipChanged = state.query !== previousQuery || state.setSize !== previousSetSize || state.setGrouping !== previousSetGrouping;
    if (setMembershipChanged) {
      state.setId = "all";
      state.currentIndex = 0;
    }
    saveState(state);
    goToCards();
  });

  return root;
}
