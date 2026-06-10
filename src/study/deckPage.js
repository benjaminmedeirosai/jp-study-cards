import { loadState, saveState, buildDeckTree, listDecks, loadBundle, deckMatchCounts, button } from "./shared.js";
import { historyDropdown, getFilterHistory, getDeckHistory, formatDuration, formatAgo } from "./filters.js";

// Indentation per tree level, in px. Half an icon width — kept modest so the
// per-row "studied" meta has room.
const INDENT = 17;

const ICONS = {
  folder: `<svg viewBox="0 0 24 24"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>`,
  folderOpen: `<svg viewBox="0 0 24 24"><path d="m6 14 1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/></svg>`,
  file: `<svg viewBox="0 0 24 24"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>`
};

function goToCards() {
  location.hash = "#/";
}

function countCards(node) {
  return node.decks.reduce((sum, deck) => sum + Number(deck.count || 0), 0)
    + node.children.reduce((sum, child) => sum + countCards(child), 0);
}

function iconSpan(svg) {
  const span = document.createElement("span");
  span.className = "deck-icon";
  span.innerHTML = svg;
  return span;
}

function labelSpan(value) {
  const span = document.createElement("span");
  span.className = "deck-row-label";
  span.textContent = value;
  return span;
}

function countBadge(value) {
  const span = document.createElement("span");
  span.className = "deck-row-count";
  span.textContent = String(value);
  return span;
}

function metaSpan(value) {
  const span = document.createElement("span");
  span.className = "deck-row-meta";
  span.textContent = value;
  return span;
}

// The content box of an entry (icon + label + [meta] + count). Interactive only
// for folder toggles; file/All-cards rows are display-only (selection is the
// button). `meta` (studied time · ago) is shown only when non-empty.
function contentRow(svg, name, total, extraClass = "", interactive = false, meta = "") {
  const el = document.createElement(interactive ? "button" : "div");
  if (interactive) el.type = "button";
  el.className = `deck-row${extraClass ? ` ${extraClass}` : ""}`;
  el.append(iconSpan(svg), labelSpan(name));
  if (meta) el.append(metaSpan(meta));
  el.append(countBadge(total));
  return el;
}

export function renderDeckPage() {
  const state = loadState();

  const root = document.createElement("section");
  root.className = "study-page decks-page";

  const top = document.createElement("header");
  top.className = "decks-top";
  const backBtn = button("Back", "decks-back", "←");
  backBtn.setAttribute("aria-label", "Back to cards");
  const title = document.createElement("h1");
  title.className = "decks-title";
  title.textContent = "Decks";
  top.append(backBtn, title);

  // Deck-name filter — narrows the list by deck/folder name (not card content).
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.className = "decks-filter decks-name-filter";
  nameInput.placeholder = "Filter decks…";
  nameInput.autocomplete = "off";
  let nameQuery = "";

  // Card-content filter — bound to state.query, so it matches the settings filter.
  const filterInput = document.createElement("input");
  filterInput.type = "text";
  filterInput.className = "decks-filter";
  filterInput.placeholder = "Filter cards…";
  filterInput.autocomplete = "off";
  filterInput.value = state.query;

  // History dropdowns: recently-studied decks, and recently-used card filters.
  const nameWrap = historyDropdown(nameInput, {
    getItems: () => getDeckHistory().map((h) => ({
      primary: h.label || h.id,
      meta: `studied ${formatDuration(h.ms)} · ${formatAgo(h.at)}`,
      value: h.id
    })),
    onPick: (it) => selectDeck(it.value),
    emptyText: "No decks studied yet"
  });
  const filterWrap = historyDropdown(filterInput, {
    getItems: () => getFilterHistory().map((h) => ({
      primary: h.q,
      meta: `studied ${formatDuration(h.ms)} · ${formatAgo(h.at)}`,
      value: h.q
    })),
    onPick: (it) => { filterInput.value = it.value; filterInput.dispatchEvent(new Event("input", { bubbles: true })); },
    emptyText: "No filters studied yet"
  });

  const list = document.createElement("div");
  list.className = "decks-list";
  const empty = document.createElement("div");
  empty.className = "decks-empty";
  empty.textContent = "Loading decks...";
  list.append(empty);

  root.append(top, nameWrap, filterWrap, list);

  let tree = [];
  let bundle = null;
  let counts = new Map();
  let historyById = new Map();
  const expanded = new Set();

  // Per-record "studied <dur> · <ago>", shown only for an id that was studied
  // *directly* (its own history entry). Never rolled up from children.
  function metaFor(id) {
    const h = historyById.get(id);
    return h ? `${formatDuration(h.ms)} · ${formatAgo(h.at)}` : "";
  }

  nameInput.addEventListener("input", () => {
    nameQuery = nameInput.value.trim().toLowerCase();
    if (bundle) renderList();
  });

  filterInput.addEventListener("input", () => {
    const next = filterInput.value.trim();
    if (next === state.query) return;
    state.query = next;
    state.setId = "all";
    state.currentIndex = 0;
    saveState(state);
    if (bundle) renderList();
  });

  function selectDeck(id) {
    if (id !== state.deckId) {
      state.deckId = id;
      state.setId = "all";
      state.currentIndex = 0;
      saveState(state);
    }
    goToCards();
  }

  // A "Select" / "Selected" button that chooses `id` as the study target.
  function useButton(id, name) {
    const isCurrent = state.deckId === id;
    const use = document.createElement("button");
    use.type = "button";
    use.className = `deck-use${isCurrent ? " is-current" : ""}`;
    use.textContent = isCurrent ? "Selected" : "Select";
    use.setAttribute("aria-label", `${isCurrent ? "Selected" : "Select"}: ${name}`);
    use.addEventListener("click", () => selectDeck(id));
    return use;
  }

  // One entry: a content row + its Select button, indented by tree depth.
  function entry(contentEl, useEl, depth = 0) {
    const wrap = document.createElement("div");
    wrap.className = "deck-entry";
    if (depth) wrap.style.paddingLeft = `${depth * INDENT}px`;
    wrap.append(contentEl, useEl);
    return wrap;
  }

  // "matched / total" while filtering, else just the total.
  function countLabel(matched, total) {
    return state.query ? `${matched} / ${total}` : `${total}`;
  }

  function matchedInNode(node) {
    let sum = 0;
    for (const deck of node.decks) sum += counts.get(deck.id) || 0;
    for (const child of node.children) sum += matchedInNode(child);
    return sum;
  }

  function fileRow(deck, depth) {
    const label = countLabel(counts.get(deck.id) || 0, Number(deck.count || 0));
    return entry(contentRow(ICONS.file, deck.label, label, "deck-row--file", false, metaFor(deck.id)), useButton(deck.id, deck.label), depth);
  }

  // --- Deck-name filtering ------------------------------------------------
  // While `nameQuery` is set, the list is narrowed to deck/folder names that
  // match (and the ancestors leading to them); a matched folder shows its whole
  // subtree. This is independent of the card-content filter (state.query).
  function nameHit(value) {
    return String(value).toLowerCase().includes(nameQuery);
  }
  function subtreeNameMatch(node) {
    return nameHit(node.name) || node.decks.some((deck) => nameHit(deck.label)) || node.children.some(subtreeNameMatch);
  }

  // The folder's content row toggles expand/collapse on tap; the "Select" button
  // chooses the folder itself (all files beneath it) as the study target.
  function folderRow(node, path, depth) {
    const isOpen = nameQuery ? true : expanded.has(path);
    const toggle = contentRow(isOpen ? ICONS.folderOpen : ICONS.folder, node.name, countLabel(matchedInNode(node), countCards(node)), "deck-folder-toggle", true, metaFor(`folder:${path}`));
    toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
    toggle.addEventListener("click", () => {
      if (expanded.has(path)) expanded.delete(path);
      else expanded.add(path);
      renderList();
    });
    return entry(toggle, useButton(`folder:${path}`, `${node.name} folder`), depth);
  }

  function renderNode(node, parentPath, depth, frag, ancestorMatch = false) {
    const path = parentPath ? `${parentPath} / ${node.name}` : node.name;
    const selfMatch = nameQuery ? nameHit(node.name) : false;
    if (nameQuery && !ancestorMatch && !selfMatch && !subtreeNameMatch(node)) return;
    frag.append(folderRow(node, path, depth));
    const open = nameQuery ? true : expanded.has(path);
    if (!open) return;
    const showAll = ancestorMatch || selfMatch; // a matched folder reveals its whole subtree
    for (const deck of node.decks) {
      if (!nameQuery || showAll || nameHit(deck.label)) frag.append(fileRow(deck, depth + 1));
    }
    for (const child of node.children) {
      if (!nameQuery || showAll || subtreeNameMatch(child)) renderNode(child, path, depth + 1, frag, showAll);
    }
  }

  function renderList() {
    counts = deckMatchCounts(bundle, state.query);
    historyById = new Map(getDeckHistory().map((h) => [h.id, h]));
    const frag = document.createDocumentFragment();
    for (const node of tree) {
      if (!nameQuery || subtreeNameMatch(node)) renderNode(node, "", 0, frag, false);
    }
    list.innerHTML = "";
    if (nameQuery && !frag.querySelector(".deck-row--file")) {
      const none = document.createElement("div");
      none.className = "decks-empty";
      none.textContent = `No decks match “${nameInput.value.trim()}”`;
      list.append(none);
      return;
    }
    list.append(frag);
  }

  // Expand the folders leading to (and including) the current selection.
  function seedExpanded(index) {
    const sel = state.deckId;
    let segments = [];
    if (sel.startsWith("folder:")) {
      segments = sel.slice("folder:".length).split("/").map((part) => part.trim()).filter(Boolean);
    } else if (sel && sel !== "all") {
      const deck = listDecks(index).find((item) => item.id === sel);
      if (deck) segments = String(deck.category || "").split("/").map((part) => part.trim()).filter(Boolean);
    }
    let acc = "";
    for (const segment of segments) {
      acc = acc ? `${acc} / ${segment}` : segment;
      expanded.add(acc);
    }
  }

  async function initialize() {
    try {
      bundle = await loadBundle();
      tree = buildDeckTree(bundle);
      seedExpanded(bundle);
      renderList();
    } catch (error) {
      empty.textContent = `Could not load decks: ${error.message || error}`;
    }
  }

  backBtn.addEventListener("click", goToCards);
  void initialize();
  return root;
}
