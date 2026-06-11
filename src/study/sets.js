// Pure set-building engine: sorting, likeness slotting, and likeness grouping.
// No DOM, no app state — just card arrays in, set-option descriptors out.

import { text, searchText, fieldName, activeLibrary, DEFAULT_SET_SIZE, SET_GROUPINGS } from "./shared.js";

// Collation locale for the active library (e.g. "ja", "es"). Used for all the
// sort tie-breaks so non-Japanese libraries sort by their own rules.
function localeFor() {
  return (activeLibrary().tts.lang || "en").split("-")[0];
}

const MIXED_KEY_DETAIL_LIMIT = 6;

// Single-entry memo of the last grouping result, shared by the card page and the
// settings preview so a re-mount / page switch with identical inputs is a pure
// redraw. The grouping calc (sort + likeness grouping) is the expensive step.
let setsCache = null;

// Filter → sort → build sets for a deck, memoized on {cacheKey, query, setSize,
// groupingId}. Every real recompute and every cache hit is logged with timing so
// it is obvious in the console when (and how long) a grouping calc runs.
export function computeDeckSets({ cacheKey, cards, query, setSize, groupingId }) {
  const normalizedQuery = String(query || "").trim().toLowerCase();
  const signature = [cacheKey, cards.length, normalizedQuery, setSize, groupingId].join(" ");
  if (setsCache && setsCache.signature === signature) {
    console.log(`[sets] cache hit · ${groupingId} · ${setsCache.result.setOptions.length} sets (no recompute)`);
    return setsCache.result;
  }
  const start = performance.now();
  const matching = normalizedQuery
    ? cards.filter((entry) => searchText(entry).includes(normalizedQuery))
    : cards;
  const deckCards = sortCardsForSets(matching, groupingId);
  const setOptions = buildSetOptions(deckCards, setSize, groupingId);
  const ms = (performance.now() - start).toFixed(1);
  console.log(`[sets] recompute · ${groupingId} · ${matching.length} cards → ${setOptions.length} sets · ${ms}ms`);
  const result = { deckCards, setOptions };
  setsCache = { signature, result };
  return result;
}

export function activeSetGrouping(groupingId) {
  return SET_GROUPINGS.find((item) => item.id === groupingId) || SET_GROUPINGS[0];
}

export function sortCardsForSets(cards, groupingId) {
  const grouping = activeSetGrouping(groupingId);
  const field = fieldName(grouping.slot) || fieldName("primary");
  const primaryField = fieldName("primary");
  const locale = localeFor();
  return [...cards].sort((a, b) => {
    const aValue = text(a, field);
    const bValue = text(b, field);
    return aValue.localeCompare(bValue, locale) || text(a, primaryField).localeCompare(text(b, primaryField), locale);
  });
}

function hanKeys(value) {
  return [...new Set([...value].filter((char) => /\p{Script=Han}/u.test(char)))];
}

// Latin-letter likeness: bigrams of the word's letters (lowercased), so words
// sharing letter sequences cluster — the Spanish analogue of kana likeness.
function letterKeys(value) {
  const letters = [...value.toLowerCase()].filter((char) => /\p{Letter}/u.test(char));
  if (letters.length <= 1) return letters;
  const keys = [];
  for (let index = 0; index < letters.length - 1; index += 1) keys.push(letters[index] + letters[index + 1]);
  return [...new Set(keys)];
}

// Small/combining kana (yōon ゃゅょ, small vowels ぁぃぅぇぉ, sokuon っ, ゎゕゖ) and
// the long-vowel mark ー belong to the preceding mora, not their own character —
// so きょ is one unit. Splitting them produced junk keys like "ょう".
const COMBINING_KANA = new Set([..."ぁぃぅぇぉっゃゅょゎゕゖー"]);

function hiraganaUnits(value) {
  const units = [];
  for (const char of value) {
    if (!/\p{Script=Hiragana}/u.test(char) && char !== "ー") continue;
    if (COMBINING_KANA.has(char) && units.length) units[units.length - 1] += char;
    else units.push(char);
  }
  return units;
}

function kanaKeys(value) {
  const units = hiraganaUnits(value);
  if (units.length <= 1) return units;
  const keys = [];
  for (let index = 0; index < units.length - 1; index += 1) keys.push(units[index] + units[index + 1]);
  return [...new Set(keys)];
}

// Likeness keys for an entry, by the grouping's `unit` extractor applied to its
// slot's field (han chars, kana mora-bigrams, or Latin letter-bigrams).
function likenessKeys(entry, grouping) {
  const value = text(entry, fieldName(grouping.slot) || fieldName("primary"));
  if (grouping.unit === "han") return hanKeys(value);
  if (grouping.unit === "kana") return kanaKeys(value);
  return letterKeys(value);
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
    .sort((a, b) => b.indexes.length - a.indexes.length || a.key.localeCompare(b.key, localeFor()));
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
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], localeFor()))
    .map(([key, count]) => `${key}(${count})`);
  if (labels.length > MIXED_KEY_DETAIL_LIMIT) return `Mixed(${indexes.length})`;
  const retainedKeys = new Set([...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key));
  const mixedCount = indexes.filter((index) => !likenessKeys(cards[index], grouping).some((key) => retainedKeys.has(key))).length;
  if (mixedCount > 0) labels.push(`Mixed(${mixedCount})`);
  return labels.length ? labels.join("|") : `Mixed(${indexes.length})`;
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

function setLength(set) {
  return set.reduce((sum, chunk) => sum + chunk.indexes.length, 0);
}

function balanceDistance(a, b) {
  return Math.abs(a - b);
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

function splitIndexesForTarget(indexes, setSize) {
  return buildBalancedSetOptions(indexes.length, setSize).map((option) => indexes.slice(option.start, option.end));
}

// Greedy likeness grouping: sort key groups biggest-first, split oversize ones
// into balanced sets, first-fit the rest into bins whose DEDUPED union stays at
// the target size, then let singletons top up the sparse ones. O(groups·bins)
// instead of the old O(groups³) iterative pairwise merge.
function buildGroupingSetOptions(cards, setSize, grouping) {
  const size = Math.max(1, Math.floor(Number(setSize) || DEFAULT_SET_SIZE));
  // The ~20% buffer is ONLY for splitting one big kanji's cards into fuller sets
  // (e.g. 24 → [12,12] rather than [8,8,8]); combining distinct groups targets
  // the plain size so unrelated kanji don't overstuff a set.
  const capacity = Math.max(size, Math.round(size * 1.2));
  // Don't dilute an already-dense likeness set with unrelated singletons.
  const fillThreshold = Math.ceil(size * 0.9);
  const keyGroups = buildLikenessKeyGroups(cards, grouping).filter((group) => group.indexes.length >= 2);

  // Each bin is one set-in-progress: a deduped index set plus the key groups
  // packed into it. Cross-set duplicates are intentional — a card belonging to
  // two key groups that land in different bins appears in both.
  const bins = [];
  const newBin = (overrides = {}) => ({ indexSet: new Set(), keys: [], mixed: 0, oversize: false, split: null, ...overrides });
  const unionCount = (bin, indexes) => {
    let count = bin.indexSet.size;
    for (const index of indexes) if (!bin.indexSet.has(index)) count += 1;
    return count;
  };
  const addGroup = (bin, group, indexes) => {
    for (const index of indexes) bin.indexSet.add(index);
    bin.keys.push({ key: group.key, count: indexes.length });
  };

  for (const group of keyGroups) {
    if (group.indexes.length > capacity) {
      // Oversize key group → balanced standalone bins (e.g. 24/cap-12 → [12,12]).
      const chunks = splitIndexesForTarget(group.indexes, capacity);
      chunks.forEach((chunk, splitIndex) => {
        const bin = newBin({ oversize: true, split: { index: splitIndex, count: chunks.length } });
        addGroup(bin, group, chunk);
        bins.push(bin);
      });
      continue;
    }
    // First fit into a packable bin whose deduped union stays at target size.
    // A fresh bin still accepts a lone group up to capacity (single-kanji buffer).
    let target = null;
    for (const bin of bins) {
      if (bin.oversize) continue;
      if (unionCount(bin, group.indexes) <= size) { target = bin; break; }
    }
    if (!target) { target = newBin(); bins.push(target); }
    addGroup(target, group, group.indexes);
  }

  // Singletons: cards that share no likeness key with any other card.
  const grouped = new Set();
  for (const group of keyGroups) for (const index of group.indexes) grouped.add(index);
  const mixed = [];
  for (let index = 0; index < cards.length; index += 1) if (!grouped.has(index)) mixed.push(index);

  // Top up only the sparse packed bins (below 90% of target) up to size; leave
  // near-full likeness sets pure. Remaining singletons get their own balanced bins.
  let next = 0;
  for (const bin of bins) {
    if (bin.oversize || bin.indexSet.size >= fillThreshold) continue;
    while (next < mixed.length && bin.indexSet.size < size) {
      bin.indexSet.add(mixed[next]);
      bin.mixed += 1;
      next += 1;
    }
  }
  if (next < mixed.length) {
    splitIndexesForTarget(mixed.slice(next), size).forEach((chunk) => {
      const bin = newBin({ mixed: chunk.length });
      for (const index of chunk) bin.indexSet.add(index);
      bins.push(bin);
    });
  }

  const binLabel = (bin, indexes) => {
    if (!bin.keys.length) return mixedKeyLabel(indexes, cards, grouping);
    const keyLabel = bin.keys.map((entry) => `${entry.key}(${entry.count})`).join("|");
    const mixedLabel = bin.mixed ? `|Mixed(${bin.mixed})` : "";
    const splitLabel = bin.split && bin.split.count > 1 ? ` ${bin.split.index + 1}/${bin.split.count}` : "";
    return `${keyLabel}${mixedLabel}${splitLabel}`;
  };

  return bins
    .filter((bin) => bin.indexSet.size > 0)
    .map((bin) => {
      const indexes = [...bin.indexSet].sort((a, b) => a - b);
      return { indexes, label: binLabel(bin, indexes), count: indexes.length };
    })
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, localeFor()))
    .map((bin, index) => {
      const setCards = bin.indexes.map((cardIndex) => cards[cardIndex]);
      const fullLabel = `${bin.label} (${setCards.length})`;
      return { id: `group:${index + 1}`, label: fullLabel, summaryLabel: fullLabel, cards: setCards, count: setCards.length };
    });
}

export function buildSetOptions(cards, setSize, groupingId) {
  const total = cards.length;
  const size = Math.max(1, Math.floor(Number(setSize) || DEFAULT_SET_SIZE));
  if (total <= size) return [{ id: "all", label: `All (${total})`, summaryLabel: `Whole deck (${total})`, start: 0, end: total, count: total }];
  const grouping = activeSetGrouping(groupingId);
  if (grouping.type === "grouping") return buildGroupingSetOptions(cards, setSize, grouping);
  if (grouping.type === "slotting") return buildSlottingSetOptions(cards, setSize, grouping);
  return buildBalancedSetOptions(total, setSize);
}
