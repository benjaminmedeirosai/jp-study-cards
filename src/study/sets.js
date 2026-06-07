// Pure set-building engine: sorting, likeness slotting, and likeness grouping.
// No DOM, no app state — just card arrays in, set-option descriptors out.

import { text, DEFAULT_SET_SIZE, SET_GROUPINGS } from "./shared.js";

const MIXED_KEY_DETAIL_LIMIT = 6;

export function activeSetGrouping(groupingId) {
  return SET_GROUPINGS.find((item) => item.id === groupingId) || SET_GROUPINGS[0];
}

export function sortCardsForSets(cards, groupingId) {
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

function splitGroupingIndexes(indexes, setSize) {
  const size = Math.max(1, Math.floor(Number(setSize) || DEFAULT_SET_SIZE));
  const nearLimit = size + Math.ceil(size / 4);
  if (indexes.length <= nearLimit) return [indexes];
  return splitIndexesForTarget(indexes, setSize);
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

export function buildSetOptions(cards, setSize, groupingId) {
  const total = cards.length;
  const size = Math.max(1, Math.floor(Number(setSize) || DEFAULT_SET_SIZE));
  if (total <= size) return [{ id: "all", label: `All (${total})`, summaryLabel: `Whole deck (${total})`, start: 0, end: total, count: total }];
  const grouping = activeSetGrouping(groupingId);
  if (grouping.type === "grouping") return buildGroupingSetOptions(cards, setSize, grouping);
  if (grouping.type === "slotting") return buildSlottingSetOptions(cards, setSize, grouping);
  return buildBalancedSetOptions(total, setSize);
}
