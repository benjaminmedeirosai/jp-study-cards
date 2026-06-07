import { loadState, saveState, buildDeckTree, listDecks, loadIndex, button } from "./shared.js";

// Indentation per tree level, in px.
const INDENT = 34;

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

// The content box of an entry (icon + label + count). Interactive only for
// folder toggles; file/All-cards rows are display-only (selection is the button).
function contentRow(svg, name, total, extraClass = "", interactive = false) {
  const el = document.createElement(interactive ? "button" : "div");
  if (interactive) el.type = "button";
  el.className = `deck-row${extraClass ? ` ${extraClass}` : ""}`;
  el.append(iconSpan(svg), labelSpan(name), countBadge(total));
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

  const list = document.createElement("div");
  list.className = "decks-list";
  const empty = document.createElement("div");
  empty.className = "decks-empty";
  empty.textContent = "Loading decks...";
  list.append(empty);

  root.append(top, list);

  let tree = [];
  const expanded = new Set();

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

  function fileRow(deck, depth) {
    return entry(contentRow(ICONS.file, deck.label, deck.count, "deck-row--file"), useButton(deck.id, deck.label), depth);
  }

  // The folder's content row toggles expand/collapse on tap; the "Select" button
  // chooses the folder itself (all files beneath it) as the study target.
  function folderRow(node, path, depth) {
    const isOpen = expanded.has(path);
    const toggle = contentRow(isOpen ? ICONS.folderOpen : ICONS.folder, node.name, countCards(node), "deck-folder-toggle", true);
    toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
    toggle.addEventListener("click", () => {
      if (expanded.has(path)) expanded.delete(path);
      else expanded.add(path);
      renderList();
    });
    return entry(toggle, useButton(`folder:${path}`, `${node.name} folder`), depth);
  }

  function renderNode(node, parentPath, depth, frag) {
    const path = parentPath ? `${parentPath} / ${node.name}` : node.name;
    frag.append(folderRow(node, path, depth));
    if (!expanded.has(path)) return;
    for (const deck of node.decks) frag.append(fileRow(deck, depth + 1));
    for (const child of node.children) renderNode(child, path, depth + 1, frag);
  }

  function renderList() {
    const frag = document.createDocumentFragment();
    for (const node of tree) renderNode(node, "", 0, frag);
    list.innerHTML = "";
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
      const index = await loadIndex();
      tree = buildDeckTree(index);
      seedExpanded(index);
      renderList();
    } catch (error) {
      empty.textContent = `Could not load decks: ${error.message || error}`;
    }
  }

  backBtn.addEventListener("click", goToCards);
  void initialize();
  return root;
}
