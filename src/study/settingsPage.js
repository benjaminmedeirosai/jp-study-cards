import { activeSetGrouping, computeDeckSets } from "./sets.js";
import { speak, getVoicesForLang, onVoicesChanged } from "./speech.js";
import { historyDropdown, getFilterHistory, formatDuration, formatAgo } from "./filters.js";
import { closeOverlay } from "./router.js";
import { schemaCaption } from "./libraries.js";
import { fetchAudioManifest } from "./audioStore.js";

const VOICE_SAMPLE = "こんにちは。これは音声のプレビューです。";
import {
  DEFAULT_SET_SIZE,
  VOICE_RATE_OPTIONS,
  SET_GROUPINGS,
  availableFonts,
  fontStack,
  FONT_PX_OPTIONS,
  nearestFontPx,
  clampInt,
  clampNum,
  normalizeSetGrouping,
  activeLibrary,
  loadState,
  saveState,
  text,
  searchText,
  matchesQuery,
  primaryText,
  readingText,
  translationText,
  loadBundle,
  resolveDeck,
  button,
  fieldLabel,
  makeSelect,
  makeToggle
} from "./shared.js";

// A divider + label that opens a group of related settings.
function sectionHeading(label) {
  const heading = document.createElement("div");
  heading.className = "settings-section";
  heading.textContent = label;
  return heading;
}

// A labelled field where a narrow input sits beside quick-pick chips. Clicking
// a chip writes its value into the input and fires `input`, so the field's
// existing listener handles it — the chips and the box stay in sync, and the
// chip matching the current value is highlighted.
function makePresetField(labelText, input, presets, className = "") {
  const field = document.createElement("div");
  field.className = `study-field preset-field ${className}`.trim();
  const span = document.createElement("span");
  span.textContent = labelText;
  const row = document.createElement("div");
  row.className = "preset-row";
  input.classList.add("preset-input");
  const chips = document.createElement("div");
  chips.className = "preset-chips";
  const buttons = presets.map((value) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "preset-chip";
    chip.textContent = String(value);
    chip.dataset.value = String(value);
    chip.addEventListener("click", () => {
      input.value = String(value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    return chip;
  });
  chips.append(...buttons);
  row.append(input, chips);
  field.append(span, row);
  const syncActive = () => {
    const current = String(input.value).trim();
    for (const chip of buttons) chip.classList.toggle("active", chip.dataset.value === current);
  };
  input.addEventListener("input", syncActive);
  syncActive();
  return field;
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
  // Caption naming which schema these settings apply to (e.g. "Japanese · Kanji")
  // — settings are stored independently per schema, so make it explicit which
  // one you're editing.
  const schemaTag = document.createElement("span");
  schemaTag.className = "settings-schema";
  schemaTag.textContent = schemaCaption(activeLibrary());
  top.append(backBtn, title, schemaTag);

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
  // History dropdown — moves queryInput into a wrapper, then back into the field.
  queryField.append(historyDropdown(queryInput, {
    getItems: () => getFilterHistory().map((h) => ({
      primary: h.q,
      meta: `studied ${formatDuration(h.ms)} · ${formatAgo(h.at)}`,
      value: h.q
    })),
    onPick: (it) => { queryInput.value = it.value; queryInput.dispatchEvent(new Event("input", { bubbles: true })); },
    emptyText: "No filters studied yet"
  }));

  // --- Set size / grouping ------------------------------------------------
  const setSizeInput = document.createElement("input");
  setSizeInput.type = "number";
  setSizeInput.min = "3";
  setSizeInput.step = "1";
  setSizeInput.value = String(state.setSize);
  // Only the groupings the active library offers.
  const offeredGroupings = activeLibrary().groupingIds
    .map((id) => SET_GROUPINGS.find((grouping) => grouping.id === id))
    .filter(Boolean);
  const setGroupingInput = makeSelect(
    offeredGroupings.map((grouping) => ({ value: grouping.id, label: grouping.label })),
    state.setGrouping
  );

  // --- Font sizes (dropdown, absolute px) ---------------------------------
  // A 12-option px dropdown (geometric scale, see FONT_PX_OPTIONS). The chosen
  // px renders identically across slots. Saved sizes from the old slider are
  // snapped onto the nearest option so the dropdown and the card agree.
  for (const key of ["kanjiFontPx", "hiraganaFontPx", "englishFontPx", "glossFontPx"]) {
    state[key] = nearestFontPx(state[key]);
  }
  saveState(state);
  function makeSizeSelect(px) {
    const select = makeSelect(FONT_PX_OPTIONS.map((p) => ({ value: String(p), label: `${p}px` })), String(nearestFontPx(px)));
    select.classList.add("font-size-select");
    return select;
  }
  const kanjiFontInput = makeSizeSelect(state.kanjiFontPx);
  const hiraganaFontInput = makeSizeSelect(state.hiraganaFontPx);
  const englishFontInput = makeSizeSelect(state.englishFontPx);
  const glossFontInput = makeSizeSelect(state.glossFontPx);
  const hotkeyToggle = makeToggle("Hotkeys", state.showHotkeys);
  const glossToggle = makeToggle("Kanji gloss", state.showGloss);

  // --- Font families (only those installed on this device) ----------------
  // Each option previews itself in its own font; the current pick is kept even
  // if detection misses it, so a saved choice never disappears. A library may
  // restrict the catalogue via `fontIds` (e.g. Spanish → a couple generics).
  function makeFontSelect(currentId) {
    const allowed = activeLibrary().fontIds;
    const fonts = availableFonts([currentId])
      .filter((font) => !allowed || allowed.includes(font.id) || font.id === currentId);
    const select = makeSelect(fonts.map((font) => ({ value: font.id, label: font.label })), currentId);
    for (const option of select.options) {
      const stack = fontStack(option.value);
      if (stack !== "inherit") option.style.fontFamily = stack;
    }
    return select;
  }
  const kanjiFontFamilyInput = makeFontSelect(state.kanjiFont);
  const hiraganaFontFamilyInput = makeFontSelect(state.hiraganaFont);
  const englishFontFamilyInput = makeFontSelect(state.englishFont);
  const glossFontFamilyInput = makeFontSelect(state.glossFont);
  // A bold "B" toggle button that highlights when on, matching the preset-chip
  // active style used elsewhere.
  function makeBoldToggle(active) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "bold-toggle";
    btn.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.6 10.79c.97-.67 1.65-1.77 1.65-2.79 0-2.26-1.75-4-4-4H7v14h7.04c2.09 0 3.71-1.7 3.71-3.79 0-1.52-.86-2.82-2.15-3.42zM10 6.5h3c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5h-3v-3zm3.5 9H10v-3h3.5c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5z"/></svg>`;
    btn.setAttribute("aria-label", "Bold");
    btn.setAttribute("aria-pressed", String(!!active));
    btn.classList.toggle("active", !!active);
    return btn;
  }
  const kanjiBoldBtn = makeBoldToggle(state.kanjiBold);
  const hiraganaBoldBtn = makeBoldToggle(state.hiraganaBold);
  const englishBoldBtn = makeBoldToggle(state.englishBold);
  const glossBoldBtn = makeBoldToggle(state.glossBold);
  // One row per lettering target: family dropdown + size dropdown + Bold toggle,
  // side by side. Family/bold are omitted for size-only targets (english, gloss).
  function fontRow({ family, size, bold }) {
    const row = document.createElement("div");
    row.className = "font-family-row";
    if (family) row.append(family);
    if (size) row.append(size);
    if (bold) row.append(bold);
    return row;
  }

  // --- Autoplay delays (seconds) ------------------------------------------
  function makeDelayInput(value) {
    const input = document.createElement("input");
    input.type = "number";
    input.min = "0.5";
    input.max = "60";
    input.step = "0.5";
    input.value = String(value);
    return input;
  }
  const questionDelayInput = makeDelayInput(state.autoplayQuestionDelay);
  const answerDelayInput = makeDelayInput(state.autoplayAnswerDelay);
  const ttsEstimateToggle = makeToggle("Add estimated TTS delay", state.autoplayEstimateTts);
  // Read all 、-separated readings vs just the first (most common). Only shown
  // for multi-reading schemas (kanji on/kun lists).
  const allReadingsToggle = makeToggle("Read all readings (not just the first)", state.voiceAllReadings);
  // Play a stored offline clip instead of live TTS when one exists for the card.
  const storedAudioToggle = makeToggle("Use stored audio if available", state.preferStoredAudio);

  // Audio voice priority: when a card has clips in several voices, play them in
  // this order (then fall back to live TTS). Scoped to THIS library's language
  // (the page is per-library), reorder with ↑/↓. Shown only when stored audio is
  // on AND this language has at least one voice pack.
  const voicePriority = document.createElement("div");
  voicePriority.className = "study-field voice-priority";
  voicePriority.hidden = true;
  const vpTitle = document.createElement("span");
  vpTitle.textContent = "Audio voice priority";
  const vpList = document.createElement("div");
  vpList.className = "voice-priority-list";
  voicePriority.append(vpTitle, vpList);

  let langVoiceCount = 0;
  function updateVoicePriorityVisibility() {
    voicePriority.hidden = !(storedAudioToggle.input.checked && langVoiceCount > 0);
  }

  function renderVoicePriority(order, voicesById) {
    vpList.replaceChildren();
    order.forEach((vid, i) => {
      const info = voicesById[vid];
      const row = document.createElement("div");
      row.className = "voice-priority-row";
      const name = document.createElement("span");
      name.className = "voice-priority-name";
      const locale = info && info.locale ? ` · ${info.locale}` : "";
      name.textContent = `${i + 1}. ${info ? info.name : vid}${locale}`;
      // Per-voice stored-clip playback speed. Independent of the TTS speed above.
      const rates = state.audioVoiceRates || (state.audioVoiceRates = {});
      const rate = makeSelect(
        VOICE_RATE_OPTIONS.map((r) => ({ value: String(r), label: `${r}×` })),
        String(Number(rates[vid]) || 1)
      );
      rate.className = "voice-rate";
      rate.addEventListener("change", () => {
        rates[vid] = Number(rate.value);
        saveState(state);
      });
      const up = button("↑", "voice-move");
      up.disabled = i === 0;
      up.addEventListener("click", () => moveVoice(order, voicesById, i, -1));
      const down = button("↓", "voice-move");
      down.disabled = i === order.length - 1;
      down.addEventListener("click", () => moveVoice(order, voicesById, i, 1));
      row.append(name, rate, up, down);
      vpList.append(row);
    });
    const fb = document.createElement("div");
    fb.className = "voice-priority-row voice-priority-fallback";
    fb.textContent = `${order.length + 1}. Live TTS (fallback)`;
    vpList.append(fb);
  }
  // `order` holds only this language's voices; persist it ahead of any voices
  // from other languages so the global list stays valid (playback filters by
  // the card's language anyway, so cross-language order is irrelevant).
  function moveVoice(order, voicesById, i, delta) {
    const j = i + delta;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    const others = (state.audioVoiceOrder || []).filter((v) => !order.includes(v));
    state.audioVoiceOrder = [...order, ...others];
    saveState(state);
    renderVoicePriority(order, voicesById);
  }
  fetchAudioManifest().then((m) => {
    const lang = activeLibrary().language;
    const info = m[lang] || {};
    const voicesById = {};
    const present = [];
    for (const [vid, v] of Object.entries(info.voices || {})) {
      voicesById[vid] = { name: v.name, locale: v.locale };
      present.push(vid);
    }
    langVoiceCount = present.length;
    updateVoicePriorityVisibility();
    if (!present.length) return;
    const global = state.audioVoiceOrder || [];
    const order = [...global.filter((v) => present.includes(v)), ...present.filter((v) => !global.includes(v))];
    state.audioVoiceOrder = [...order, ...global.filter((v) => !present.includes(v))];
    saveState(state);
    renderVoicePriority(order, voicesById);
  });

  // --- Voice (Web Speech API voices for the active library's language) ----
  const library = activeLibrary();
  const voiceLangPrefix = (library.tts.lang || "en").split("-")[0];
  const voiceSelect = document.createElement("select");
  function populateVoices() {
    const desired = voiceSelect.options.length ? voiceSelect.value : state.voice;
    voiceSelect.innerHTML = "";
    const items = [{ value: "", label: "Auto (device default)" }];
    for (const voice of getVoicesForLang(voiceLangPrefix)) items.push({ value: voice.name, label: `${voice.name} · ${voice.lang}` });
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

  // Standing sound-source choice for "library"-scope schemas (e.g. kanji
  // on'yomi/kun'yomi/both). Word schemas pick this per card on the tray instead.
  const soundSourceOptions = library.soundSources || [];
  const soundSourceSelect = makeSelect(
    soundSourceOptions.map((option) => ({ value: option.value, label: option.label })),
    soundSourceOptions.some((option) => option.value === state.soundSource) ? state.soundSource : (soundSourceOptions[0]?.value || "")
  );
  soundSourceSelect.addEventListener("change", () => {
    state.soundSource = soundSourceSelect.value;
    saveState(state);
  });

  const voicePreviewBtn = document.createElement("button");
  voicePreviewBtn.type = "button";
  voicePreviewBtn.className = "voice-preview";
  voicePreviewBtn.setAttribute("aria-label", "Preview voice");
  voicePreviewBtn.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5l12 7-12 7z"/></svg><span>Preview</span>`;
  voicePreviewBtn.addEventListener("click", () => speak(library.voiceSample || VOICE_SAMPLE, { lang: library.tts.lang, voiceName: voiceSelect.value, rate: Number(rateSelect.value) }));
  // Live-TTS speed lives in the same row as the voice it modifies, making it
  // clear the speed applies to TTS (stored-clip speeds are set per voice in the
  // priority list below).
  rateSelect.classList.add("voice-rate");
  const voiceRow = document.createElement("div");
  voiceRow.className = "voice-row";
  voiceRow.append(voiceSelect, rateSelect, voicePreviewBtn);

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
    const count = query ? base.filter((entry) => matchesQuery(entry, query)).length : base.length;
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
      setSize: clampInt(setSizeInput.value, DEFAULT_SET_SIZE, 3, 100000),
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
      // Use the active library's field accessors (not hardcoded Japanese keys),
      // so the preview shows the real primary text for any schema (Farsi letters,
      // Spanish/Farsi words, kanji…).
      const previewWords = optionCards.map((entry) => primaryText(entry) || readingText(entry) || translationText(entry)).join(" · ");
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
    state.setSize = clampInt(setSizeInput.value, DEFAULT_SET_SIZE, 3, 100000);
    if (state.setSize !== previous) {
      state.setId = "all";
      state.currentIndex = 0;
    }
    saveState(state);
    updateSettingsPreview();
  });
  setGroupingInput.addEventListener("change", () => {
    const previous = state.setGrouping;
    state.setGrouping = normalizeSetGrouping(setGroupingInput.value);
    if (state.setGrouping !== previous) {
      state.setId = "all";
      state.currentIndex = 0;
    }
    saveState(state);
    updateSettingsPreview();
  });

  // One combined row per target: [family] [size] [bold]. Family/bold only for
  // the script slots (primary, reading); english/gloss are size-only.
  const L = library.labels;
  const kanjiFontField = fieldLabel(`${L.primary} font`, fontRow({ family: kanjiFontFamilyInput, size: kanjiFontInput, bold: kanjiBoldBtn }));
  const hiraganaFontField = fieldLabel(`${L.reading || "Reading"} font`, fontRow({ family: hiraganaFontFamilyInput, size: hiraganaFontInput, bold: hiraganaBoldBtn }));
  const englishFontField = fieldLabel(`${L.translation || "English"} font`, fontRow({ family: englishFontFamilyInput, size: englishFontInput, bold: englishBoldBtn }));
  const glossFontField = fieldLabel(`${L.gloss || "Gloss"} font`, fontRow({ family: glossFontFamilyInput, size: glossFontInput, bold: glossBoldBtn }));
  function wireFontSize(select, key) {
    select.addEventListener("change", () => {
      state[key] = Number(select.value);
      saveState(state);
    });
  }
  wireFontSize(kanjiFontInput, "kanjiFontPx");
  wireFontSize(hiraganaFontInput, "hiraganaFontPx");
  wireFontSize(englishFontInput, "englishFontPx");
  wireFontSize(glossFontInput, "glossFontPx");

  kanjiFontFamilyInput.addEventListener("change", () => {
    state.kanjiFont = kanjiFontFamilyInput.value;
    saveState(state);
  });
  hiraganaFontFamilyInput.addEventListener("change", () => {
    state.hiraganaFont = hiraganaFontFamilyInput.value;
    saveState(state);
  });
  englishFontFamilyInput.addEventListener("change", () => {
    state.englishFont = englishFontFamilyInput.value;
    saveState(state);
  });
  glossFontFamilyInput.addEventListener("change", () => {
    state.glossFont = glossFontFamilyInput.value;
    saveState(state);
  });
  function wireBold(btn, key) {
    btn.addEventListener("click", () => {
      state[key] = !state[key];
      btn.classList.toggle("active", state[key]);
      btn.setAttribute("aria-pressed", String(state[key]));
      saveState(state);
    });
  }
  wireBold(kanjiBoldBtn, "kanjiBold");
  wireBold(hiraganaBoldBtn, "hiraganaBold");
  wireBold(englishBoldBtn, "englishBold");
  wireBold(glossBoldBtn, "glossBold");

  voiceSelect.addEventListener("change", () => {
    state.voice = voiceSelect.value;
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
  questionDelayInput.addEventListener("input", () => {
    state.autoplayQuestionDelay = clampNum(questionDelayInput.value, 4, 0.5, 60);
    saveState(state);
  });
  answerDelayInput.addEventListener("input", () => {
    state.autoplayAnswerDelay = clampNum(answerDelayInput.value, 3, 0.5, 60);
    saveState(state);
  });
  ttsEstimateToggle.input.addEventListener("change", () => {
    state.autoplayEstimateTts = ttsEstimateToggle.input.checked;
    saveState(state);
  });
  allReadingsToggle.input.addEventListener("change", () => {
    state.voiceAllReadings = allReadingsToggle.input.checked;
    saveState(state);
  });
  storedAudioToggle.input.addEventListener("change", () => {
    state.preferStoredAudio = storedAudioToggle.input.checked;
    saveState(state);
    updateVoicePriorityVisibility();
  });

  const visibilityGroup = document.createElement("div");
  visibilityGroup.className = "settings-toggle-grid";
  // The gloss toggle only applies to libraries with the gloss feature (Japanese).
  visibilityGroup.append(hotkeyToggle.label, ...(activeLibrary().features.gloss ? [glossToggle.label] : []));

  content.append(
    sectionHeading("Filter & sets"),
    queryField,
    makePresetField("Set size", setSizeInput, [5, 7, 10, 15, 50]),
    fieldLabel("Set grouping", setGroupingInput),
    setPreview,
    sectionHeading("Fonts"),
    kanjiFontField,
    // Reading font controls only for libraries with a reading field.
    ...(library.fields.reading ? [hiraganaFontField] : []),
    englishFontField,
    // Gloss/forms size: libraries with the gloss feature (Japanese) or a forms
    // table (Farsi alphabet, where this slot sizes the positional forms).
    ...(library.features.gloss || library.features.formsTable ? [glossFontField] : []),
    sectionHeading("Voice & speed"),
    fieldLabel(`${library.label} voice & speed`, voiceRow),
    // Which reading to speak — only library-scope schemas (kanji); word schemas
    // choose per card on the tray.
    ...(library.soundSourceScope === "library" && soundSourceOptions.length > 1
      ? [fieldLabel("Spoken reading", soundSourceSelect)] : []),
    ...(library.features.multiReading ? [allReadingsToggle.label] : []),
    storedAudioToggle.label,
    voicePriority,
    sectionHeading("Autoplay"),
    makePresetField("Question delay (sec)", questionDelayInput, [0.5, 1, 1.5, 2, 3]),
    makePresetField("Answer delay (sec)", answerDelayInput, [0.5, 1, 1.5, 2, 3]),
    ttsEstimateToggle.label,
    sectionHeading("Other"),
    visibilityGroup
  );

  form.append(content);
  root.append(top, form);

  updateFilterCount();
  updateSettingsPreview();

  // --- Wiring -------------------------------------------------------------
  backBtn.addEventListener("click", closeOverlay);
  // Settings apply immediately, so there is nothing to submit.
  form.addEventListener("submit", (event) => event.preventDefault());

  // Escape closes the page (back to cards). An open filter dropdown swallows
  // Escape in the capture phase (see historyDropdown), so this only fires when
  // no dropdown is open. Self-removes once the page is detached.
  function onEscClose(event) {
    if (!root.isConnected) { document.removeEventListener("keydown", onEscClose); return; }
    if (event.key === "Escape") { event.preventDefault(); closeOverlay(); }
  }
  document.addEventListener("keydown", onEscClose);

  return root;
}
