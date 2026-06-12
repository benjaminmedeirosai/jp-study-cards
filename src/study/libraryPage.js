// Library picker overlay (reached via #/library): choose a language, then a
// schema within it (Japanese → Words / Kanji; Spanish → Words). Mirrors the deck
// page's shell + list styling. Selecting a schema switches the active one and
// returns to the cards view.

import { loadState, button } from "./shared.js";
import { libraryGroups } from "./libraries.js";
import { chooseLibrary, closeOverlay } from "./router.js";

export function renderLibraryPage() {
  const state = loadState();

  const root = document.createElement("section");
  root.className = "study-page decks-page library-page";

  const top = document.createElement("header");
  top.className = "decks-top";
  const backBtn = button("Back", "decks-back", "←");
  backBtn.setAttribute("aria-label", "Back to cards");
  const title = document.createElement("h1");
  title.className = "decks-title";
  title.textContent = "Library";
  top.append(backBtn, title);

  const list = document.createElement("div");
  list.className = "decks-list";

  // One section per language; its schemas are the selectable rows beneath it.
  for (const { language, schemas } of libraryGroups()) {
    const header = document.createElement("div");
    header.className = "library-language";
    const shortEl = document.createElement("span");
    shortEl.className = "library-short";
    shortEl.textContent = language.short;
    const nameEl = document.createElement("span");
    nameEl.className = "library-language-label";
    nameEl.textContent = language.label;
    header.append(shortEl, nameEl);
    list.append(header);

    for (const library of schemas) {
      const isCurrent = state.libraryId === library.id;

      const row = document.createElement("div");
      row.className = "deck-row library-schema-row";
      const labelEl = document.createElement("span");
      labelEl.className = "deck-row-label";
      labelEl.textContent = library.schemaLabel;
      row.append(labelEl);

      const use = document.createElement("button");
      use.type = "button";
      use.className = `deck-use${isCurrent ? " is-current" : ""}`;
      use.textContent = isCurrent ? "Selected" : "Select";
      use.setAttribute("aria-label", `${isCurrent ? "Selected" : "Select"}: ${language.label} ${library.schemaLabel}`);
      use.addEventListener("click", () => chooseLibrary(library.id));

      const entry = document.createElement("div");
      entry.className = "deck-entry library-schema-entry";
      entry.append(row, use);
      list.append(entry);
    }
  }

  root.append(top, list);

  backBtn.addEventListener("click", closeOverlay);

  // Escape closes the page (back to cards). Self-removes once detached.
  function onEscClose(event) {
    if (!root.isConnected) { document.removeEventListener("keydown", onEscClose); return; }
    if (event.key === "Escape") { event.preventDefault(); closeOverlay(); }
  }
  document.addEventListener("keydown", onEscClose);

  return root;
}
