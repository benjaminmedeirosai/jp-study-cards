import { speak } from "./speech.js";

const APP_VERSION = "app-v22";
const FALLBACK_DATA_VERSION = "data-v1";
const STORAGE_KEY = "jp-study-cards-state-v1";
const DEFAULT_SET_SIZE = 20;
const MIXED_KEY_DETAIL_LIMIT = 6;
const FONT_SCALE_OPTIONS = [10, 20, 35, 50, 75, 100, 125, 150, 200, 250];
const LINK_TEMPLATES = {
  chatgpt: "https://chat.openai.com/?q=",
  googleImages: "https://www.google.com/search?tbm=isch&q="
};
const MODES = [
  { id: "kanji", label: "Kanji" },
  { id: "english", label: "English" },
  { id: "hiragana", label: "Hiragana" },
  { id: "voice", label: "Voice" }
];
const SET_GROUPINGS = [
  { id: "kanji-alpha", label: "Alphabetical (kanji)", key: "kanji", type: "alpha" },
  { id: "hiragana-alpha", label: "Alphabetical (hiragana)", key: "hiragana", type: "alpha" },
  { id: "kanji-likeness-slotting", label: "Kanji - likeness slotting", key: "kanji", type: "slotting" },
  { id: "kanji-likeness-grouping", label: "Kanji - likeness grouping *", key: "kanji", type: "grouping" },
  { id: "hiragana-likeness-slotting", label: "Hiragana - likeness slotting", key: "hiragana", type: "slotting" },
  { id: "hiragana-likeness-grouping", label: "Hiragana - likeness grouping *", key: "hiragana", type: "grouping" }
];

function clampInt(value, fallback, min, max) {
  const next = Math.floor(Number(value));
  if (!Number.isFinite(next)) return fallback;
  return Math.max(min, Math.min(max, next));
}

function normalizeSetGrouping(value) {
  if (value === "kanji-likeness") return "kanji-likeness-slotting";
  if (value === "hiragana-likeness") return "hiragana-likeness-slotting";
  return SET_GROUPINGS.some((grouping) => grouping.id === value) ? value : "kanji-alpha";
}

function loadState() {
  let raw = {};
  try { raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); } catch {}
  const visible = raw.visible && typeof raw.visible === "object" ? raw.visible : {};
  return {
    layerId: String(raw.layerId || "All cards"),
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
    cacheRefreshedAt: Number.isFinite(Date.parse(raw.cacheRefreshedAt || "")) ? raw.cacheRefreshedAt : "",
    visible: {
      kanji: visible.kanji !== false,
      type: visible.type !== false,
      hiragana: visible.hiragana !== false,
      english: visible.english !== false
    },
    ttsSources: raw.ttsSources && typeof raw.ttsSources === "object" ? raw.ttsSources : {}
  };
}

function saveState(state) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
}

function text(entry, key) {
  return String(entry?.[key] ?? "").trim();
}

function entryKey(entry) {
  return [text(entry, "kanji"), text(entry, "hiragana"), text(entry, "english")].join("|");
}

function searchText(entry) {
  return [entry?.kanji, entry?.hiragana, entry?.english, entry?.type].join(" ").toLowerCase();
}

function studySearchText(entry) {
  return text(entry, "kanji") || text(entry, "hiragana") || text(entry, "english");
}

function openSearchLink(template, entry) {
  const value = studySearchText(entry);
  if (value) window.open(template + encodeURIComponent(value), "_blank");
}

function button(label, className = "", icon = "") {
  const el = document.createElement("button");
  el.type = "button";
  el.className = `japanese-study-button ${className}`.trim();
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

function setButtonHotkey(buttonEl, hotkey) {
  const el = document.createElement("span");
  el.className = "hotkey";
  el.textContent = hotkey;
  buttonEl.append(el);
}

function setButtonText(buttonEl, value) {
  const textEl = buttonEl.querySelector(".text");
  if (textEl) textEl.textContent = value;
  else buttonEl.textContent = value;
}

function soundOptionsIcon() {
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

function formatCacheDate(value) {
  if (!value) return "not refreshed yet";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "size unavailable";
  const mb = bytes / 1024 / 1024;
  if (mb >= 10) return `${Math.round(mb)} MB`;
  return `${mb.toFixed(1)} MB`;
}

async function getCacheStorageBytes() {
  if (!("caches" in window)) return null;
  const keys = await caches.keys();
  const appKeys = keys.filter((key) => key.startsWith("jp-study-cards-app-") || key === "jp-study-cards-data" || key.startsWith("jp-study-cards-lite"));
  let bytes = 0;
  for (const key of appKeys) {
    const cache = await caches.open(key);
    const requests = await cache.keys();
    for (const request of requests) {
      const response = await cache.match(request);
      if (response) bytes += (await response.clone().blob()).size;
    }
  }
  return bytes;
}

function dataVersionFromIndex(index) {
  return String(index?.version || index?.generatedAt || FALLBACK_DATA_VERSION);
}

async function getCachedDataVersion() {
  if (!("caches" in window)) return FALLBACK_DATA_VERSION;
  const cached = await caches.match("/data/index.json");
  if (!cached) return FALLBACK_DATA_VERSION;
  return dataVersionFromIndex(await cached.json());
}

async function getLatestDataVersion() {
  const response = await fetch("/data/index.json", { cache: "reload" });
  if (!response.ok) throw new Error(`data/index.json: ${response.status}`);
  return dataVersionFromIndex(await response.json());
}

function parseTsvDeck(source, path) {
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

async function parseDeckResponse(response, path) {
  if (path.endsWith(".tsv")) return parseTsvDeck(await response.text(), path);
  return response.json();
}

async function refreshCachedFiles() {
  if (!("serviceWorker" in navigator)) {
    throw new Error("Offline cache needs HTTPS or localhost. A phone on a plain http://LAN address cannot use service workers.");
  }
  const registration = await navigator.serviceWorker.ready;
  await registration.update().catch(() => {});
  const worker = registration.active || navigator.serviceWorker.controller;
  if (!worker) throw new Error("Service worker is not active yet.");
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("Cache refresh timed out."));
    }, 30000);
    function cleanup() {
      window.clearTimeout(timeout);
      navigator.serviceWorker.removeEventListener("message", onMessage);
    }
    function onMessage(event) {
      if (event.data?.type !== "RESYNC_CACHE_RESULT") return;
      cleanup();
      if (event.data.ok) resolve(event.data);
      else reject(new Error(event.data.error || "Cache refresh failed."));
    }
    navigator.serviceWorker.addEventListener("message", onMessage);
    worker.postMessage({ type: "RESYNC_CACHE" });
  });
}

function requestWorkerVersion(worker) {
  if (!worker) return Promise.resolve(null);
  return new Promise((resolve) => {
    const requestId = `version:${Date.now()}:${Math.random()}`;
    const timeout = window.setTimeout(() => {
      cleanup();
      resolve(null);
    }, 2000);
    function cleanup() {
      window.clearTimeout(timeout);
      navigator.serviceWorker.removeEventListener("message", onMessage);
    }
    function onMessage(event) {
      if (event.data?.type !== "VERSION_RESULT" || event.data.requestId !== requestId) return;
      cleanup();
      resolve({
        version: event.data.version,
        appCacheName: event.data.appCacheName || event.data.cacheName,
        dataCacheName: event.data.dataCacheName
      });
    }
    navigator.serviceWorker.addEventListener("message", onMessage);
    worker.postMessage({ type: "GET_VERSION", requestId });
  });
}

async function getCacheVersionInfo() {
  const [currentData, latestData] = await Promise.all([
    getCachedDataVersion().catch(() => FALLBACK_DATA_VERSION),
    getLatestDataVersion().catch(() => null)
  ]);
  if (!("serviceWorker" in navigator)) {
    return {
      appCurrent: APP_VERSION,
      appLatest: APP_VERSION,
      dataCurrent: currentData,
      dataLatest: latestData || currentData,
      appHasUpdate: false,
      dataHasUpdate: Boolean(latestData && latestData !== currentData),
      hasUpdate: Boolean(latestData && latestData !== currentData)
    };
  }
  const registration = await navigator.serviceWorker.ready;
  await registration.update().catch(() => {});
  const active = await requestWorkerVersion(registration.active || navigator.serviceWorker.controller);
  const dataHasUpdate = Boolean(latestData && latestData !== currentData);
  return {
    appCurrent: APP_VERSION,
    workerCurrent: active?.version || "none",
    dataCurrent: currentData,
    dataLatest: latestData || currentData,
    dataCache: active?.dataCacheName || "jp-study-cards-data",
    appHasUpdate: false,
    dataHasUpdate,
    hasUpdate: dataHasUpdate
  };
}

async function watchForCacheUpdate(onChange) {
  if (!("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.ready;
  function markWaiting() {
    if (registration.waiting && navigator.serviceWorker.controller) onChange(true);
  }
  registration.addEventListener("updatefound", () => {
    const worker = registration.installing;
    worker?.addEventListener("statechange", () => {
      if (worker.state === "installed" && navigator.serviceWorker.controller) onChange(true);
    });
  });
  markWaiting();
  await registration.update().catch(() => {});
  markWaiting();
  void getCacheVersionInfo()
    .then((info) => onChange(info.hasUpdate))
    .catch(() => {});
}

function fieldLabel(labelText, input, className = "") {
  const label = document.createElement("label");
  label.className = `japanese-study-field ${className}`.trim();
  const span = document.createElement("span");
  span.textContent = labelText;
  label.append(span, input);
  return label;
}

function makeSelect(items, value) {
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

function makeToggle(labelText, checked) {
  const label = document.createElement("label");
  label.className = "japanese-study-toggle";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = !!checked;
  const span = document.createElement("span");
  span.textContent = labelText;
  label.append(input, span);
  return { label, input };
}

function setSlotVisible(el, visible) {
  el.classList.toggle("is-invisible", !visible);
}

function activeSetGrouping(groupingId) {
  return SET_GROUPINGS.find((item) => item.id === groupingId) || SET_GROUPINGS[0];
}

function sortCardsForSets(cards, groupingId) {
  const grouping = activeSetGrouping(groupingId);
  return [...cards].sort((a, b) => {
    const aValue = text(a, grouping.key);
    const bValue = text(b, grouping.key);
    return aValue.localeCompare(bValue, "ja") || text(a, "kanji").localeCompare(text(b, "kanji"), "ja");
  });
}

function kanjiKeys(entry) {
  return [...new Set([...text(entry, "kanji")].filter((char) => /\p{Script=Han}/u.test(char)))];
}

function hiraganaKeys(entry) {
  const chars = [...text(entry, "hiragana")].filter((char) => /\p{Script=Hiragana}/u.test(char));
  if (chars.length <= 1) return chars;
  const keys = [];
  for (let index = 0; index < chars.length - 1; index += 1) keys.push(chars.slice(index, index + 2).join(""));
  return [...new Set(keys)];
}

function likenessKeys(entry, grouping) {
  return grouping.key === "kanji" ? kanjiKeys(entry) : hiraganaKeys(entry);
}

function buildLikenessKeyGroups(cards, grouping) {
  const groups = new Map();
  cards.forEach((entry, index) => {
    for (const key of likenessKeys(entry, grouping)) {
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(index);
    }
  });
  return [...groups.entries()]
    .map(([key, indexes]) => ({ key, indexes }))
    .sort((a, b) => b.indexes.length - a.indexes.length || a.key.localeCompare(b.key, "ja"));
}

function keyCountLabel(groups) {
  return groups
    .map((group) => `${group.key}(${group.indexes.length})`)
    .join("|");
}

function mixedKeyLabel(indexes, cards, grouping) {
  const counts = new Map();
  for (const index of indexes) {
    const keys = likenessKeys(cards[index], grouping);
    if (!keys.length) continue;
    keys.forEach((key) => counts.set(key, (counts.get(key) || 0) + 1));
  }
  const labels = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ja"))
    .map(([key, count]) => `${key}(${count})`);
  if (labels.length > MIXED_KEY_DETAIL_LIMIT) return `Mixed(${indexes.length})`;
  const retainedKeys = new Set([...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key));
  const mixedCount = indexes.filter((index) => !likenessKeys(cards[index], grouping).some((key) => retainedKeys.has(key))).length;
  if (mixedCount > 0) labels.push(`Mixed(${mixedCount})`);
  return labels.length ? labels.join("|") : `Mixed(${indexes.length})`;
}

function combineMatchingLikenessGroups(groups) {
  const combined = new Map();
  for (const group of groups) {
    const signature = group.indexes.join("|");
    if (!combined.has(signature)) combined.set(signature, { indexes: group.indexes, groups: [] });
    combined.get(signature).groups.push(group);
  }
  return [...combined.values()]
    .map((item) => ({ ...item, label: keyCountLabel(item.groups) }))
    .sort((a, b) => b.indexes.length - a.indexes.length || a.label.localeCompare(b.label, "ja"));
}

function groupsOverlap(a, b) {
  return a.indexes.some((index) => b.indexes.includes(index));
}

function mergedGroup(a, b) {
  return {
    indexes: [...new Set([...a.indexes, ...b.indexes])].sort((x, y) => x - y),
    groups: [...a.groups, ...b.groups]
  };
}

function combineOverlappingLikenessGroups(groups, setSize) {
  const size = Math.max(1, Math.floor(Number(setSize) || DEFAULT_SET_SIZE));
  const combined = groups.map((group) => ({ indexes: group.indexes, groups: group.groups }));
  let merged = true;
  while (merged) {
    merged = false;
    for (let left = 0; left < combined.length && !merged; left += 1) {
      for (let right = left + 1; right < combined.length; right += 1) {
        const candidate = mergedGroup(combined[left], combined[right]);
        if (!groupsOverlap(combined[left], combined[right]) || candidate.indexes.length > size) continue;
        combined[left] = candidate;
        combined.splice(right, 1);
        merged = true;
        break;
      }
    }
  }
  return combined
    .map((item) => ({ ...item, label: keyCountLabel(item.groups) }))
    .sort((a, b) => b.indexes.length - a.indexes.length || a.label.localeCompare(b.label, "ja"));
}

function buildBalancedSetOptions(total, setSize) {
  const size = Math.max(1, Math.floor(Number(setSize) || DEFAULT_SET_SIZE));
  const setCount = Math.ceil(total / size);
  const baseSize = Math.floor(total / setCount);
  const extraCount = total % setCount;
  const options = [];
  for (let start = 0, index = 1; index <= setCount; index += 1) {
    const count = baseSize + (index <= extraCount ? 1 : 0);
    const end = start + count;
    options.push({ id: `set:${index}`, label: `${start + 1}-${end}`, summaryLabel: `Set ${index} (${start + 1}-${end})`, start, end, count: end - start });
    start = end;
  }
  return options;
}

function buildSlottingSetOptions(cards, setSize, grouping) {
  const size = Math.max(1, Math.floor(Number(setSize) || DEFAULT_SET_SIZE));
  const assigned = new Set();
  const chunks = [];
  function addChunks(indexes) {
    const remainder = indexes.length % size;
    const fullCount = Math.floor(indexes.length / size);
    if (remainder > 0 && remainder < Math.ceil(size / 2) && fullCount > 0) {
      const baseSize = Math.floor(indexes.length / fullCount);
      const extraCount = indexes.length % fullCount;
      for (let start = 0, index = 0; index < fullCount; index += 1) {
        const count = baseSize + (index < extraCount ? 1 : 0);
        chunks.push(indexes.slice(start, start + count));
        start += count;
      }
      return;
    }
    for (let start = 0; start < indexes.length; start += size) {
      chunks.push(indexes.slice(start, start + size));
    }
  }
  for (const group of buildLikenessKeyGroups(cards, grouping)) {
    const unslotted = group.indexes.filter((index) => !assigned.has(index));
    if (!unslotted.length) continue;
    unslotted.forEach((index) => assigned.add(index));
    addChunks(unslotted);
  }
  for (let index = 0; index < cards.length; index += 1) {
    if (assigned.has(index)) continue;
    addChunks([index]);
  }
  const sets = [];
  const sortedChunks = chunks
    .map((indexes, index) => ({ indexes, order: index }))
    .sort((a, b) => b.indexes.length - a.indexes.length || a.order - b.order);
  for (const chunk of sortedChunks) {
    const target = chunk.indexes.length < size
      ? sets.find((set) => setLength(set) + chunk.indexes.length <= size)
      : null;
    if (target) target.push(chunk);
    else sets.push([chunk]);
  }
  balanceSlottingSets(sets, size);
  return sets
    .map((set) => set.flatMap((chunk) => chunk.indexes))
    .filter((indexes) => indexes.length)
    .map((indexes, index) => {
      const setCards = indexes.map((cardIndex) => cards[cardIndex]);
      return { id: `set:${index + 1}`, label: `Set ${index + 1} (${setCards.length})`, summaryLabel: `Set ${index + 1} (${setCards.length})`, cards: setCards, count: setCards.length };
    });
}

function setLength(set) {
  return set.reduce((sum, chunk) => sum + chunk.indexes.length, 0);
}

function balanceSlottingSets(sets, setSize) {
  let moved = true;
  while (moved) {
    moved = false;
    const ordered = sets
      .map((set, index) => ({ set, index, length: setLength(set) }))
      .sort((a, b) => a.length - b.length || a.index - b.index);
    for (const small of ordered) {
      for (let largeIndex = ordered.length - 1; largeIndex >= 0; largeIndex -= 1) {
        const large = ordered[largeIndex];
        if (large.index === small.index || large.length <= small.length + 1) continue;
        const movableIndex = large.set.findIndex((chunk) => (
          chunk.indexes.length < setSize
          && small.length + chunk.indexes.length <= setSize
          && balanceDistance(large.length, small.length) > balanceDistance(large.length - chunk.indexes.length, small.length + chunk.indexes.length)
        ));
        if (movableIndex === -1) continue;
        small.set.push(large.set.splice(movableIndex, 1)[0]);
        moved = true;
        break;
      }
      if (moved) break;
    }
  }
}

function balanceDistance(a, b) {
  return Math.abs(a - b);
}

function splitIndexesForTarget(indexes, setSize) {
  return buildBalancedSetOptions(indexes.length, setSize).map((option) => indexes.slice(option.start, option.end));
}

function splitGroupingIndexes(indexes, setSize) {
  const size = Math.max(1, Math.floor(Number(setSize) || DEFAULT_SET_SIZE));
  const nearLimit = size + Math.ceil(size / 4);
  if (indexes.length <= nearLimit) return [indexes];
  return splitIndexesForTarget(indexes, setSize);
}

function groupedOption(id, label, indexes, cards, setSize, summaryLabel = label, splitLabelForIndexes = null) {
  return splitGroupingIndexes(indexes, setSize).map((split, index, allSplits) => {
    const splitCards = split.map((cardIndex) => cards[cardIndex]);
    const baseLabel = splitLabelForIndexes ? splitLabelForIndexes(split) : label;
    const baseSummary = splitLabelForIndexes ? splitLabelForIndexes(split) : summaryLabel;
    const splitLabel = allSplits.length > 1 ? `${baseLabel} ${index + 1}/${allSplits.length} (${splitCards.length})` : `${baseLabel} (${splitCards.length})`;
    const splitSummary = allSplits.length > 1 ? `${baseSummary} ${index + 1}/${allSplits.length} (${splitCards.length})` : `${baseSummary} (${splitCards.length})`;
    return { id: `${id}:${index + 1}`, label: splitLabel, summaryLabel: splitSummary, cards: splitCards, count: splitCards.length };
  });
}

function groupingOptionFromParts(id, label, groupIndexes, mixedIndexes, cards, splitIndex = 0, splitCount = 1) {
  const indexes = [...groupIndexes, ...mixedIndexes];
  const setCards = indexes.map((cardIndex) => cards[cardIndex]);
  const mixedLabel = mixedIndexes.length ? `|Mixed(${mixedIndexes.length})` : "";
  const splitLabel = splitCount > 1 ? ` ${splitIndex + 1}/${splitCount}` : "";
  const fullLabel = `${label}${mixedLabel}${splitLabel} (${setCards.length})`;
  return { id, label: fullLabel, summaryLabel: fullLabel, cards: setCards, count: setCards.length };
}

function groupingPartLength(part) {
  return part.groupIndexes.length + part.mixedIndexes.length;
}

function balanceGroupingParts(parts, setSize) {
  const size = Math.max(1, Math.floor(Number(setSize) || DEFAULT_SET_SIZE));
  let moved = true;
  while (moved) {
    moved = false;
    const realParts = parts
      .filter((part) => part.groupIndexes.length)
      .sort((a, b) => groupingPartLength(a) - groupingPartLength(b));
    const mixedParts = parts
      .filter((part) => !part.groupIndexes.length && part.mixedIndexes.length)
      .sort((a, b) => groupingPartLength(b) - groupingPartLength(a));
    const target = realParts.find((part) => groupingPartLength(part) < size);
    const source = mixedParts.find((part) => groupingPartLength(part) > Math.max(1, groupingPartLength(target || part) + 1));
    if (!target || !source) break;
    target.mixedIndexes.push(source.mixedIndexes.shift());
    moved = true;
  }
  return parts.filter((part) => groupingPartLength(part));
}

function buildGroupingSetOptions(cards, setSize, grouping) {
  const parts = [];
  const groupedIndexes = new Set();
  const realGroups = buildLikenessKeyGroups(cards, grouping).filter((group) => group.indexes.length >= 2);
  const combinedGroups = combineOverlappingLikenessGroups(combineMatchingLikenessGroups(realGroups), setSize);
  combinedGroups.forEach((group) => group.indexes.forEach((cardIndex) => groupedIndexes.add(cardIndex)));
  const mixedQueue = cards
    .map((_, index) => index)
    .filter((index) => !groupedIndexes.has(index));
  for (const group of combinedGroups) {
    const splits = splitGroupingIndexes(group.indexes, setSize);
    splits.forEach((split, splitIndex) => {
      parts.push({ id: `group:${group.label}:${splitIndex + 1}`, label: group.label, groupIndexes: split, mixedIndexes: [], splitIndex, splitCount: splits.length });
    });
  }
  if (mixedQueue.length) {
    splitGroupingIndexes(mixedQueue, setSize).forEach((split, splitIndex, splits) => {
      parts.push({ id: `group:mixed:${splitIndex + 1}`, label: "Mixed", groupIndexes: [], mixedIndexes: split, splitIndex, splitCount: splits.length });
    });
  }
  return balanceGroupingParts(parts, setSize).map((part) => {
    const label = part.groupIndexes.length ? part.label : mixedKeyLabel(part.mixedIndexes, cards, grouping);
    return groupingOptionFromParts(part.id, label, part.groupIndexes, part.mixedIndexes, cards, part.splitIndex, part.splitCount);
  });
}

function buildSetOptions(cards, setSize, groupingId) {
  const total = cards.length;
  const size = Math.max(1, Math.floor(Number(setSize) || DEFAULT_SET_SIZE));
  if (total <= size) return [{ id: "all", label: `All (${total})`, summaryLabel: `Whole deck (${total})`, start: 0, end: total, count: total }];
  const grouping = activeSetGrouping(groupingId);
  if (grouping.type === "grouping") return buildGroupingSetOptions(cards, setSize, grouping);
  if (grouping.type === "slotting") return buildSlottingSetOptions(cards, setSize, grouping);
  return buildBalancedSetOptions(total, setSize);
}

function groupDecks(index) {
  const realDecks = Array.isArray(index?.decks) ? index.decks : [];
  const groups = [{ id: "All cards", label: "All cards", decks: [{ id: "all", label: "All cards", count: realDecks.reduce((sum, deck) => sum + Number(deck.count || 0), 0), paths: realDecks.map((deck) => deck.path) }] }];
  const byCategory = new Map();
  for (const deck of realDecks) {
    const category = String(deck.category || "Other");
    if (!byCategory.has(category)) byCategory.set(category, []);
    byCategory.get(category).push({ ...deck, paths: [deck.path] });
  }
  for (const [category, decks] of byCategory) groups.push({ id: category, label: category, decks });
  return groups;
}

export function renderJapaneseStudyPage() {
  const root = document.createElement("section");
  root.className = "japanese-study-page";

  let state = loadState();
  root.classList.toggle("show-hotkeys", state.showHotkeys);
  let index = null;
  let groups = groupDecks(index);
  let loadedDecks = new Map();
  let deckCards = [];
  let setCards = [];
  let setOptions = buildSetOptions(setCards, state.setSize, state.setGrouping);
  let revealed = false;
  let audioSourceExpanded = state.audioSourceExpanded;
  let renderVersion = 0;
  let cacheUpdateAvailable = false;

  const top = document.createElement("header");
  top.className = "japanese-study-top";
  const layerSelect = makeSelect([], state.layerId);
  const deckSelect = makeSelect([], state.deckId);
  const setSelect = makeSelect([], state.setId);
  const modeSelect = makeSelect(MODES.map((mode) => ({ value: mode.id, label: mode.label })), state.mode);
  const settingsBtn = button("Settings", "settings", "⚙");
  settingsBtn.classList.add("japanese-study-settings-open");
  const summary = document.createElement("div");
  summary.className = "japanese-study-summary";
  const deckRow = document.createElement("div");
  deckRow.className = "japanese-study-header-row deck-row";
  const setField = fieldLabel(`Set (${state.setSize})`, setSelect);
  const setFieldText = setField.querySelector("span");
  deckRow.append(fieldLabel("Layer", layerSelect), fieldLabel("Deck", deckSelect), setField);
  const settingsRow = document.createElement("div");
  settingsRow.className = "japanese-study-header-row settings-row";
  settingsRow.append(fieldLabel("Mode", modeSelect), settingsBtn);
  top.append(deckRow, settingsRow, summary);

  const card = document.createElement("article");
  card.className = "japanese-study-card";
  const cardType = document.createElement("div");
  cardType.className = "japanese-study-card-slot card-type";
  const cardReading = document.createElement("div");
  cardReading.className = "japanese-study-card-slot card-reading";
  const cardMain = document.createElement("div");
  cardMain.className = "japanese-study-card-slot card-main";
  const cardEnglish = document.createElement("div");
  cardEnglish.className = "japanese-study-card-slot card-english";
  card.append(cardType, cardReading, cardMain, cardEnglish);

  const audioSourceRow = document.createElement("div");
  audioSourceRow.className = "japanese-study-audio-source-row";
  const audioSourceLabel = document.createElement("div");
  audioSourceLabel.className = "japanese-study-audio-source-label";
  audioSourceLabel.textContent = "Sound";
  const miniButtonRail = document.createElement("div");
  miniButtonRail.className = "japanese-study-mini-button-rail";
  const audioSourceToggleBtn = button("Sound options", "mini-button tts-source-toggle");
  audioSourceToggleBtn.innerHTML = soundOptionsIcon();
  audioSourceToggleBtn.setAttribute("aria-label", "Toggle sound options");
  audioSourceToggleBtn.setAttribute("aria-expanded", "true");
  const shuffleSetBtn = button("Shuffle", "mini-button shuffle-set");
  shuffleSetBtn.innerHTML = "⇄";
  shuffleSetBtn.setAttribute("aria-label", "Shuffle current set");
  miniButtonRail.append(audioSourceToggleBtn, shuffleSetBtn);
  const audioSourceControl = document.createElement("div");
  audioSourceControl.className = "japanese-study-audio-source-control";
  audioSourceControl.setAttribute("role", "radiogroup");
  const audioKanjiBtn = button("Kanji", "tts-source");
  const audioAutoBtn = button("Auto", "tts-source");
  const audioReadingBtn = button("Hiragana", "tts-source");
  audioKanjiBtn.dataset.value = "kanji";
  audioAutoBtn.dataset.value = "auto";
  audioReadingBtn.dataset.value = "hiragana";
  audioSourceControl.append(audioKanjiBtn, audioAutoBtn, audioReadingBtn);
  const audioActions = document.createElement("div");
  audioActions.className = "japanese-study-audio-actions";
  const chatgptBtn = button("ChatGPT", "audio-action link-action chatgpt", "💬");
  const jpSoundBtn = button("Sound", "audio-action audio inline-audio", "🔊");
  const imagesBtn = button("Images", "audio-action link-action images", "▧");
  audioActions.append(chatgptBtn, jpSoundBtn, imagesBtn);
  audioSourceRow.append(audioSourceLabel, miniButtonRail, audioSourceControl, audioActions);

  const footer = document.createElement("footer");
  footer.className = "japanese-study-footer";
  const prevBtn = button("Prev", "nav", "←");
  const revealBtn = button("Reveal", "primary reveal", "◉");
  const nextBtn = button("Next", "nav", "→");
  setButtonHotkey(prevBtn, "←");
  setButtonHotkey(jpSoundBtn, "S");
  setButtonHotkey(revealBtn, "Space");
  setButtonHotkey(nextBtn, "→");
  footer.append(prevBtn, revealBtn, nextBtn);

  const empty = document.createElement("div");
  empty.className = "japanese-study-empty";
  empty.textContent = "Loading Japanese words...";
  root.append(top, card, empty, audioSourceRow, footer);

  function activeGroup() {
    return groups.find((group) => group.id === state.layerId) || groups[0];
  }

  function activeDeck() {
    const group = activeGroup();
    return group?.decks.find((deck) => deck.id === state.deckId) || group?.decks[0] || null;
  }

  async function loadDeck(deck) {
    const paths = deck?.paths || (deck?.path ? [deck.path] : []);
    const all = [];
    for (const path of paths) {
      if (!loadedDecks.has(path)) {
        const response = await fetch(path);
        if (!response.ok) throw new Error(`${path}: ${response.status}`);
        loadedDecks.set(path, await parseDeckResponse(response, path));
      }
      all.push(...loadedDecks.get(path));
    }
    return all;
  }

  function updateDeckControls() {
    layerSelect.innerHTML = "";
    for (const group of groups) {
      const option = document.createElement("option");
      option.value = group.id;
      option.textContent = group.label;
      layerSelect.append(option);
    }
    if (!groups.some((group) => group.id === state.layerId)) state.layerId = groups[0]?.id || "All cards";
    layerSelect.value = state.layerId;

    const group = activeGroup();
    deckSelect.innerHTML = "";
    for (const deck of group?.decks || []) {
      const option = document.createElement("option");
      option.value = deck.id;
      option.textContent = `${deck.label} (${deck.count})`;
      deckSelect.append(option);
    }
    if (!group?.decks.some((deck) => deck.id === state.deckId)) state.deckId = group?.decks[0]?.id || "all";
    deckSelect.value = state.deckId;
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

  async function rebuildDeck({ keepIndex = false } = {}) {
    const deck = activeDeck();
    const loadedCards = await loadDeck(deck);
    const query = state.query.toLowerCase();
    const matchingCards = query ? loadedCards.filter((entry) => searchText(entry).includes(query)) : loadedCards;
    deckCards = sortCardsForSets(matchingCards, state.setGrouping);
    setOptions = buildSetOptions(deckCards, state.setSize, state.setGrouping);
    const activeSet = setOptions.find((set) => set.id === state.setId) || setOptions[0];
    setCards = activeSet?.cards || deckCards.slice(activeSet.start, activeSet.end);
    if (!keepIndex) state.currentIndex = 0;
    if (state.currentIndex >= setCards.length) state.currentIndex = Math.max(0, setCards.length - 1);
    revealed = false;
  }

  function currentEntry() {
    return setCards[state.currentIndex] || null;
  }

  function getCurrentTtsSource() {
    const key = entryKey(currentEntry());
    return key && state.ttsSources[key] ? state.ttsSources[key] : "auto";
  }

  function getJapaneseSpeechText(entry) {
    const source = getCurrentTtsSource();
    if (source === "hiragana") return text(entry, "hiragana") || text(entry, "kanji");
    return text(entry, "kanji") || text(entry, "hiragana");
  }

  function renderAudioSourceControl() {
    const entry = currentEntry();
    const source = getCurrentTtsSource();
    audioSourceRow.classList.toggle("source-collapsed", !audioSourceExpanded);
    audioSourceToggleBtn.setAttribute("aria-expanded", audioSourceExpanded ? "true" : "false");
    audioSourceToggleBtn.disabled = !entry;
    audioSourceControl.dataset.selected = source;
    for (const btn of [audioKanjiBtn, audioAutoBtn, audioReadingBtn]) {
      const selected = btn.dataset.value === source;
      btn.classList.toggle("active", selected);
      btn.setAttribute("role", "radio");
      btn.setAttribute("aria-checked", selected ? "true" : "false");
      btn.disabled = !entry;
    }
    chatgptBtn.disabled = !entry;
    jpSoundBtn.disabled = !entry;
    imagesBtn.disabled = !entry;
    shuffleSetBtn.disabled = setCards.length <= 1;
  }

  function setCacheUpdateAvailable(value) {
    cacheUpdateAvailable = !!value;
    settingsBtn.classList.toggle("cache-update-available", cacheUpdateAvailable);
    settingsBtn.setAttribute(
      "aria-label",
      cacheUpdateAvailable ? "Settings, cache update available" : "Settings"
    );
  }

  function speakJapanese() {
    const value = getJapaneseSpeechText(currentEntry());
    if (value) speak(value, { lang: "ja-JP" });
  }

  function renderCard() {
    const entry = currentEntry();
    const total = setCards.length;
    const group = activeGroup();
    const deck = activeDeck();
    const activeSet = setOptions.find((set) => set.id === state.setId) || setOptions[0];
    empty.hidden = total > 0;
    card.hidden = total === 0;
    audioSourceRow.hidden = total === 0;
    footer.hidden = total === 0;
    summary.textContent = deck ? `${group.label} / ${deck.label} / ${activeSet?.summaryLabel || "Whole deck"}` : "No deck";
    prevBtn.disabled = total <= 1;
    nextBtn.disabled = total <= 1;
    if (!entry) {
      empty.textContent = index ? "No cards match this deck or filter." : "Loading Japanese words...";
      return;
    }
    const kanji = text(entry, "kanji");
    const hiragana = text(entry, "hiragana");
    const english = text(entry, "english");
    const type = text(entry, "type");
    const mainText = kanji || hiragana || "-";
    card.style.setProperty("--japanese-main-font-scale", String(state.kanjiFontScale / 150));
    card.style.setProperty("--japanese-reading-font-scale", String(state.hiraganaFontScale / 150));
    card.style.setProperty("--japanese-english-font-scale", String(state.englishFontScale / 150));
    cardType.textContent = type;
    cardMain.textContent = mainText;
    cardReading.textContent = hiragana;
    cardEnglish.textContent = english;
    setSlotVisible(cardType, state.visible.type && !!type);
    setSlotVisible(cardMain, (revealed ? state.visible.kanji : state.mode === "kanji") && !!mainText);
    setSlotVisible(cardReading, (revealed ? state.visible.hiragana : state.mode === "hiragana") && !!hiragana);
    setSlotVisible(cardEnglish, (revealed ? state.visible.english : state.mode === "english") && !!english);
    setButtonText(revealBtn, revealed ? "Hide" : "Reveal");
    renderAudioSourceControl();
  }

  async function renderAll(options = {}) {
    const version = ++renderVersion;
    updateDeckControls();
    await rebuildDeck(options);
    if (version !== renderVersion) return;
    updateSetControl();
    renderCard();
    saveState(state);
  }

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

  function openSettingsDialog() {
    document.querySelectorAll(".japanese-study-settings-backdrop").forEach((el) => el.remove());
    const backdrop = document.createElement("div");
    backdrop.className = "japanese-study-settings-backdrop";
    const dialog = document.createElement("div");
    dialog.className = "japanese-study-settings-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.tabIndex = -1;
    const title = document.createElement("div");
    title.className = "japanese-study-settings-title";
    title.textContent = "Settings";
    const form = document.createElement("form");
    form.className = "japanese-study-settings-form";
    const settingsContent = document.createElement("div");
    settingsContent.className = "japanese-study-settings-content";
    const queryInput = document.createElement("input");
    queryInput.placeholder = "filter";
    queryInput.value = state.query;
    queryInput.autocomplete = "off";
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
    const fontItems = FONT_SCALE_OPTIONS.map((value) => ({ value: String(value), label: `${value}%` }));
    const kanjiFontInput = makeSelect(fontItems, String(state.kanjiFontScale));
    const hiraganaFontInput = makeSelect(fontItems, String(state.hiraganaFontScale));
    const englishFontInput = makeSelect(fontItems, String(state.englishFontScale));
    const hotkeyToggle = makeToggle("Hotkeys", state.showHotkeys);
    const queryField = fieldLabel("Filter", queryInput, "filter-field");
    const queryText = queryField.querySelector("span");
    const setPreview = document.createElement("div");
    setPreview.className = "japanese-study-set-preview";
    const setPreviewTitle = document.createElement("div");
    setPreviewTitle.className = "japanese-study-set-preview-title";
    setPreviewTitle.textContent = "Set preview";
    const setPreviewNote = document.createElement("div");
    setPreviewNote.className = "japanese-study-set-preview-note";
    const setPreviewRows = document.createElement("div");
    setPreviewRows.className = "japanese-study-set-preview-rows";
    setPreview.append(setPreviewTitle, setPreviewNote, setPreviewRows);
    let previewBaseCards = deckCards.length ? deckCards : setCards;
    void loadDeck(activeDeck())
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
        row.className = "japanese-study-set-preview-row";
        row.dataset.setPreviewRow = "";
        row.setAttribute("aria-label", `${option.label}: ${previewWords}`);
        const label = document.createElement("span");
        label.className = "japanese-study-set-preview-label";
        label.textContent = option.label;
        const words = document.createElement("span");
        words.className = "japanese-study-set-preview-words";
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
    updateFilterCount();
    const visibilityGroup = document.createElement("div");
    visibilityGroup.className = "japanese-study-settings-toggle-grid";
    visibilityGroup.append(hotkeyToggle.label);
    const cacheRow = document.createElement("div");
    cacheRow.className = "japanese-study-cache-row";
    const cacheStatus = document.createElement("div");
    cacheStatus.className = "japanese-study-cache-status";
    cacheStatus.setAttribute("aria-live", "polite");
    const cacheVersion = document.createElement("div");
    cacheVersion.className = "japanese-study-cache-version";
    cacheVersion.setAttribute("aria-live", "polite");
    cacheVersion.textContent = `App: current ${APP_VERSION}`;
    const dataVersion = document.createElement("div");
    dataVersion.className = "japanese-study-cache-version";
    dataVersion.setAttribute("aria-live", "polite");
    dataVersion.textContent = `Collection: current ${FALLBACK_DATA_VERSION}`;
    function setCacheStatus(bytes = null) {
      const size = bytes === null ? "calculating..." : formatBytes(bytes);
      cacheStatus.textContent = `Last pull: ${formatCacheDate(state.cacheRefreshedAt)} · ${size}`;
    }
    function setCacheVersion(info) {
      if (!info) {
        cacheVersion.textContent = `App: current ${APP_VERSION}`;
        dataVersion.textContent = `Collection: current ${FALLBACK_DATA_VERSION}`;
        return;
      }
      cacheVersion.textContent = `App: loaded ${info.appCurrent}`;
      dataVersion.textContent = info.dataHasUpdate
        ? `Collection: current ${info.dataCurrent} · available ${info.dataLatest}`
        : `Collection: current ${info.dataCurrent} · latest ${info.dataLatest}`;
    }
    setCacheStatus();
    void getCacheStorageBytes()
      .then((bytes) => setCacheStatus(bytes))
      .catch(() => { cacheStatus.textContent = `Last pull: ${formatCacheDate(state.cacheRefreshedAt)} · size unavailable`; });
    void getCacheVersionInfo()
      .then((info) => {
        setCacheVersion(info);
        setCacheUpdateAvailable(info.hasUpdate);
      })
      .catch(() => {
        cacheVersion.textContent = `App: current ${APP_VERSION} · latest unknown`;
        dataVersion.textContent = `Collection: current ${FALLBACK_DATA_VERSION} · latest unknown`;
      });
    const refreshCacheBtn = document.createElement("button");
    refreshCacheBtn.type = "button";
    refreshCacheBtn.className = "japanese-study-dialog-button";
    refreshCacheBtn.textContent = "Pull updates";
    const cacheInfo = document.createElement("div");
    cacheInfo.className = "japanese-study-cache-info";
    cacheInfo.append(cacheStatus, cacheVersion, dataVersion);
    cacheRow.append(cacheInfo, refreshCacheBtn);
    settingsContent.append(
      queryField,
      fieldLabel("Set size", setSizeInput),
      fieldLabel("Set grouping", setGroupingInput),
      setPreview,
      fieldLabel(`Kanji size ${state.kanjiFontScale}%`, kanjiFontInput),
      fieldLabel(`Hiragana size ${state.hiraganaFontScale}%`, hiraganaFontInput),
      fieldLabel(`English size ${state.englishFontScale}%`, englishFontInput),
      visibilityGroup,
      cacheRow
    );
    const actions = document.createElement("div");
    actions.className = "japanese-study-settings-actions";
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "japanese-study-dialog-button";
    cancelBtn.textContent = "Cancel";
    const saveBtn = document.createElement("button");
    saveBtn.type = "submit";
    saveBtn.className = "japanese-study-dialog-button primary";
    saveBtn.textContent = "Save";
    actions.append(cancelBtn, saveBtn);
    form.append(settingsContent, actions);
    dialog.append(title, form);
    backdrop.append(dialog);
    document.body.append(backdrop);
    updateSettingsPreview();
    function close() { backdrop.remove(); document.removeEventListener("keydown", onEsc); }
    function onEsc(event) { if (event.key === "Escape") close(); }
    document.addEventListener("keydown", onEsc);
    backdrop.addEventListener("click", (event) => { if (event.target === backdrop) close(); });
    cancelBtn.addEventListener("click", close);
    refreshCacheBtn.addEventListener("click", async () => {
      refreshCacheBtn.disabled = true;
      cacheStatus.textContent = "Pulling updates...";
      try {
        const result = await refreshCachedFiles();
        state.cacheRefreshedAt = new Date().toISOString();
        saveState(state);
        const bytes = await getCacheStorageBytes();
        cacheStatus.textContent = `Cached ${result.count} files · ${formatCacheDate(state.cacheRefreshedAt)} · ${formatBytes(bytes)}`;
        const info = await getCacheVersionInfo();
        setCacheVersion(info);
        setCacheUpdateAvailable(info.hasUpdate);
      } catch (error) {
        cacheStatus.textContent = error.message;
      } finally {
        refreshCacheBtn.disabled = false;
      }
    });
    form.addEventListener("submit", async (event) => {
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
      root.classList.toggle("show-hotkeys", state.showHotkeys);
      close();
      await renderAll({ keepIndex: !setMembershipChanged });
    });
    requestAnimationFrame(() => dialog.focus());
  }

  layerSelect.addEventListener("change", async () => {
    state.layerId = layerSelect.value;
    state.deckId = activeGroup()?.decks[0]?.id || "all";
    state.setId = "all";
    state.currentIndex = 0;
    await renderAll({ keepIndex: false });
  });
  deckSelect.addEventListener("change", async () => {
    state.deckId = deckSelect.value;
    state.setId = "all";
    state.currentIndex = 0;
    await renderAll({ keepIndex: false });
  });
  setSelect.addEventListener("change", async () => {
    state.setId = setSelect.value;
    state.currentIndex = 0;
    await renderAll({ keepIndex: false });
  });
  modeSelect.addEventListener("change", () => {
    state.mode = modeSelect.value;
    revealed = false;
    saveState(state);
    renderCard();
    if (state.mode === "voice") speakJapanese();
  });
  settingsBtn.addEventListener("click", openSettingsDialog);
  audioSourceToggleBtn.addEventListener("click", () => {
    audioSourceExpanded = !audioSourceExpanded;
    state.audioSourceExpanded = audioSourceExpanded;
    saveState(state);
    renderAudioSourceControl();
  });
  shuffleSetBtn.addEventListener("click", shuffleCurrentSet);
  audioKanjiBtn.addEventListener("click", () => setTtsSource("kanji"));
  audioAutoBtn.addEventListener("click", () => setTtsSource("auto"));
  audioReadingBtn.addEventListener("click", () => setTtsSource("hiragana"));
  prevBtn.addEventListener("click", () => move(-1));
  nextBtn.addEventListener("click", () => move(1));
  revealBtn.addEventListener("click", reveal);
  jpSoundBtn.addEventListener("click", speakJapanese);
  chatgptBtn.addEventListener("click", () => openSearchLink(LINK_TEMPLATES.chatgpt, currentEntry()));
  imagesBtn.addEventListener("click", () => openSearchLink(LINK_TEMPLATES.googleImages, currentEntry()));

  function setTtsSource(value) {
    const key = entryKey(currentEntry());
    if (!key) return;
    if (value === "kanji" || value === "hiragana") state.ttsSources[key] = value;
    else delete state.ttsSources[key];
    saveState(state);
    renderAudioSourceControl();
    speakJapanese();
  }

  document.addEventListener("keydown", (event) => {
    const tag = String(event.target?.tagName || "").toLowerCase();
    if (["input", "select", "textarea"].includes(tag) || event.target?.isContentEditable) return;
    if (event.key === "ArrowLeft") { event.preventDefault(); move(-1); }
    else if (event.key === "ArrowRight") { event.preventDefault(); move(1); }
    else if (event.key === " " || event.key === "Enter") { event.preventDefault(); reveal(); }
    else if (event.key.toLowerCase() === "s") { event.preventDefault(); speakJapanese(); }
  });

  async function initialize() {
    try {
      const response = await fetch("/data/index.json");
      if (!response.ok) throw new Error(`data/index.json: ${response.status}`);
      index = await response.json();
      groups = groupDecks(index);
      await renderAll({ keepIndex: true });
      if (state.mode === "voice") speakJapanese();
    } catch (error) {
      empty.hidden = false;
      empty.textContent = `Could not load Japanese words: ${error.message || error}`;
      card.hidden = true;
      audioSourceRow.hidden = true;
      footer.hidden = true;
    }
  }

  renderCard();
  void watchForCacheUpdate(setCacheUpdateAvailable);
  void initialize();
  return root;
}
