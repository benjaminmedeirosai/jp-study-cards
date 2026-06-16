// Library picker overlay (reached via #/library): choose a language, then a
// schema within it (Japanese → Words / Kanji; Spanish → Words). Mirrors the deck
// page's shell + list styling. Selecting a schema switches the active one and
// returns to the cards view.
//
// This page is also where offline audio is imported: one .zip populates every
// deck it covers, and each schema row shows its total entries + how many have
// an audio clip.

import { loadState, button } from "./shared.js";
import { libraryGroups } from "./libraries.js";
import { chooseLibrary, closeOverlay } from "./router.js";
import { importAudioZip, clipKeyForEntry, allClipKeys, clearAllClips, requestPersist } from "./audioStore.js";

// Per-schema noun for the entry count.
const KIND_NOUN = { word: "words", kanji: "kanji", alpha: "letters", harakat: "marks" };

export function renderLibraryPage() {
  const state = loadState();
  const groups = libraryGroups();

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

  // Offline-audio import bar.
  const importBar = document.createElement("div");
  importBar.className = "library-import";
  const importInput = document.createElement("input");
  importInput.type = "file";
  importInput.accept = ".zip,application/zip";
  importInput.hidden = true;
  const loadBtn = button("Load audio", "settings-button primary");
  const importBtn = button("Import .zip", "settings-button");
  const clearBtn = button("Clear all", "settings-button");
  const importStatus = document.createElement("span");
  importStatus.className = "library-import-status";
  importBar.append(loadBtn, importBtn, clearBtn, importStatus, importInput);

  const list = document.createElement("div");
  list.className = "decks-list";

  // schema id → its meta element (filled async once bundles + clip keys load).
  const metaEls = new Map();

  for (const { language, schemas } of groups) {
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
      const metaEl = document.createElement("span");
      metaEl.className = "library-schema-meta";
      metaEls.set(library.id, metaEl);
      row.append(labelEl, metaEl);

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

  root.append(top, importBar, list);

  // --- Per-schema totals + audio tally ------------------------------------
  async function refreshMeta() {
    const keySet = await allClipKeys();
    for (const { schemas } of groups) {
      let bundle = null;
      try { bundle = await (await fetch(schemas[0].data)).json(); } catch {}
      for (const lib of schemas) {
        const el = metaEls.get(lib.id);
        if (!el) continue;
        if (!bundle) { el.textContent = ""; continue; }
        const entries = bundle.decks
          .filter((d) => (d.kind || "word") === lib.deckKind)
          .flatMap((d) => d.entries);
        const total = entries.length;
        const audio = entries.reduce((n, e) => n + (keySet.has(clipKeyForEntry(e, lib)) ? 1 : 0), 0);
        const noun = KIND_NOUN[lib.deckKind] || "cards";
        const audioPart = total === 0 ? "" : (audio === 0 ? " · no audio" : ` · audio ${audio}/${total}`);
        el.textContent = `${total} ${noun}${audioPart}`;
        el.classList.toggle("full-audio", total > 0 && audio === total);
        el.classList.toggle("partial-audio", audio > 0 && audio < total);
      }
    }
  }

  // --- Load wiring --------------------------------------------------------
  // Fetch the audio packs bundled with the app (public/audio/<lang>.zip) and
  // import them — on demand only. Re-clicking re-pulls (cache: "reload") and
  // overwrites, so it doubles as a "refresh all audio" button. Languages with
  // no published pack just 404 and are skipped.
  const langIds = groups.map((g) => g.language.id);
  loadBtn.addEventListener("click", async () => {
    importStatus.textContent = "Loading…";
    try {
      await requestPersist();
      let matched = 0, unmatched = 0, packs = 0;
      for (const lang of langIds) {
        let res;
        try { res = await fetch(`public/audio/${lang}.zip`, { cache: "reload" }); }
        catch { continue; }
        if (!res.ok) continue;
        const r = await importAudioZip(await res.arrayBuffer());
        matched += r.matched; unmatched += r.unmatched; packs++;
      }
      importStatus.textContent = packs
        ? `Loaded ${matched} clip${matched === 1 ? "" : "s"} from ${packs} pack${packs === 1 ? "" : "s"}${unmatched ? ` · ${unmatched} unmatched` : ""}`
        : "No bundled audio packs found";
      await refreshMeta();
    } catch (err) {
      importStatus.textContent = `Load failed: ${err.message}`;
    }
  });

  // --- Import wiring -------------------------------------------------------
  importBtn.addEventListener("click", () => importInput.click());
  importInput.addEventListener("change", async () => {
    const file = importInput.files[0];
    importInput.value = "";
    if (!file) return;
    importStatus.textContent = "Importing…";
    try {
      await requestPersist();
      const { matched, unmatched } = await importAudioZip(file);
      importStatus.textContent = `Imported ${matched} clip${matched === 1 ? "" : "s"}${unmatched ? ` · ${unmatched} unmatched` : ""}`;
      await refreshMeta();
    } catch (err) {
      importStatus.textContent = `Import failed: ${err.message}`;
    }
  });
  clearBtn.addEventListener("click", async () => {
    await clearAllClips();
    importStatus.textContent = "Cleared all audio";
    await refreshMeta();
  });

  refreshMeta();

  backBtn.addEventListener("click", closeOverlay);

  // Escape closes the page (back to cards). Self-removes once detached.
  function onEscClose(event) {
    if (!root.isConnected) { document.removeEventListener("keydown", onEscClose); return; }
    if (event.key === "Escape") { event.preventDefault(); closeOverlay(); }
  }
  document.addEventListener("keydown", onEscClose);

  return root;
}
