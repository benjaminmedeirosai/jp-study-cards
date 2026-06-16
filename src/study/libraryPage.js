// Library picker overlay (reached via #/library): choose a language, then a
// schema within it (Japanese → Words / Kanji; Spanish → Words). Mirrors the deck
// page's shell + list styling. Selecting a schema switches the active one and
// returns to the cards view.
//
// This page is also where offline audio is imported: one .zip populates every
// deck it covers, and each schema row shows its total entries + how many have
// an audio clip.

import { loadState, saveState, button } from "./shared.js";
import { libraryGroups } from "./libraries.js";
import { chooseLibrary, closeOverlay } from "./router.js";
import { importAudioZip, clipKeyForEntry, allClipKeys, clearAllClips, clearClips, countClips, getAudioMeta, requestPersist, fetchAudioManifest } from "./audioStore.js";

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
  // language id → header size element (total audio footprint, filled async).
  const langSizeEls = new Map();
  const langSrcEls = new Map();   // language id → source tag (Library / Imported)
  const langClearEls = new Map(); // language id → per-language clear button

  for (const { language, schemas } of groups) {
    const header = document.createElement("div");
    header.className = "library-language";
    const shortEl = document.createElement("span");
    shortEl.className = "library-short";
    shortEl.textContent = language.short;
    const nameEl = document.createElement("span");
    nameEl.className = "library-language-label";
    nameEl.textContent = language.label;
    const sizeEl = document.createElement("span");
    sizeEl.className = "library-language-size";
    // Source tag: published packs come from the library (re-loadable via "Load
    // audio"); others are manual zip imports (gone until you re-import the file).
    const srcEl = document.createElement("span");
    srcEl.className = "library-language-source";
    // Drop just this language's audio (published → also clears its loaded
    // version so "Load audio" re-offers it; imported → gone until re-import).
    const clearOne = button("Clear", "library-clear-one");
    clearOne.hidden = true;
    clearOne.addEventListener("click", async () => {
      await clearClips(language.id);
      const st = loadState();
      if (st.audioPackVersions && st.audioPackVersions[language.id]) { delete st.audioPackVersions[language.id]; saveState(st); }
      importStatus.textContent = `Cleared ${language.label} audio`;
      refreshLoadButton();
      await refreshMeta();
    });
    langSizeEls.set(language.id, sizeEl);
    langSrcEls.set(language.id, srcEl);
    langClearEls.set(language.id, clearOne);
    header.append(shortEl, nameEl, sizeEl, srcEl, clearOne);
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

  // The manifest (public/audio/manifest.json) lists the published packs: a
  // content version per language + the voices in each, with display names.
  let manifest = {};

  // Short voice name for the meta line: "Carlos (Enhanced)" → "Carlos".
  const shortVoice = (name) => String(name || "").replace(/\s*\([^)]*\)/, "").trim();
  const formatBytes = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

  // --- Per-schema totals + per-voice audio tally --------------------------
  async function refreshMeta() {
    const keySet = await allClipKeys();
    for (const { language, schemas } of groups) {
      let bundle = null;
      try { bundle = await (await fetch(schemas[0].data)).json(); } catch {}
      // Voices come from the published manifest AND any imported pack's
      // voices.json (Japanese is import-only, so it's absent from the manifest).
      // imported is { version, voices } (tolerate the older bare map).
      const imported = await getAudioMeta(language.id).catch(() => null);
      const importedVoices = (imported && (imported.voices || imported)) || {};
      // Merge per voice (field-wise), not whole objects — an imported pack that
      // predates the `bytes` field must not wipe the manifest's size info.
      const voices = {};
      for (const [vid, v] of Object.entries((manifest[language.id] && manifest[language.id].voices) || {})) voices[vid] = { ...v };
      for (const [vid, v] of Object.entries(importedVoices)) voices[vid] = { ...(voices[vid] || {}), ...v };
      const loaded = (await countClips(language.id)) > 0;
      // Per-language audio footprint, shown on the header only when this
      // language actually has clips stored. Byte totals are declared in the
      // manifest / voices.json — never recomputed here.
      const sizeEl = langSizeEls.get(language.id);
      if (sizeEl) {
        const totalBytes = Object.values(voices).reduce((a, v) => a + (v.bytes || 0), 0);
        sizeEl.textContent = loaded && totalBytes ? ` · ${formatBytes(totalBytes)}` : "";
      }
      // Source tag + per-language clear. "Library" packs are published (in the
      // manifest) and re-loadable; others are manual imports.
      const published = !!manifest[language.id];
      const srcEl = langSrcEls.get(language.id);
      if (srcEl) {
        srcEl.textContent = published ? "Library" : (loaded ? "Imported" : "Import only");
        srcEl.classList.toggle("is-imported", !published);
      }
      const clearOne = langClearEls.get(language.id);
      if (clearOne) clearOne.hidden = !loaded;
      for (const lib of schemas) {
        const el = metaEls.get(lib.id);
        if (!el) continue;
        if (!bundle) { el.textContent = ""; continue; }
        const entries = bundle.decks
          .filter((d) => (d.kind || "word") === lib.deckKind)
          .flatMap((d) => d.entries);
        const total = entries.length;
        // An entry "has audio" for a voice if a clip exists under ANY of the
        // library's sound sources (Japanese stores per-source keys: kanji/hiragana).
        const srcs = lib.soundSources && lib.soundSources.length > 1 ? lib.soundSources.map((s) => s.value) : [""];
        const parts = [];
        let anyPartial = false;
        for (const [vid, info] of Object.entries(voices)) {
          const n = entries.reduce((a, e) => a + (srcs.some((src) => keySet.has(clipKeyForEntry(e, lib, vid, src))) ? 1 : 0), 0);
          if (n === 0) continue;
          parts.push(`${shortVoice(info.name)} ${n}/${total}`);
          if (n < total) anyPartial = true;
        }
        const noun = KIND_NOUN[lib.deckKind] || "cards";
        el.textContent = `${total} ${noun}` + (parts.length ? ` · ${parts.join(" · ")}` : (total ? " · no audio" : ""));
        el.classList.toggle("full-audio", parts.length > 0 && !anyPartial);
        el.classList.toggle("partial-audio", parts.length > 0 && anyPartial);
      }
    }
  }

  // --- Load wiring (version-aware) ----------------------------------------
  // We track which version is loaded per language; the button is enabled only
  // when something is missing/outdated and disabled ("Audio up to date") once
  // every published pack matches what's loaded. On demand only.
  // A pack is "stale" if its loaded version differs from the manifest OR it has
  // no clips actually in storage — the recorded version alone can lie (cleared
  // via devtools, or IndexedDB evicted under storage pressure, while the
  // localStorage version survives), which is what makes "up to date" disagree
  // with a "no audio" tally. Verifying clips exist keeps the two consistent.
  const outdatedLangs = async () => {
    const loaded = loadState().audioPackVersions || {};
    const out = [];
    for (const lang of Object.keys(manifest)) {
      const versionMismatch = loaded[lang] !== manifest[lang].version;
      const hasClips = (await countClips(lang)) > 0;
      if (versionMismatch || !hasClips) out.push(lang);
    }
    return out;
  };
  async function refreshLoadButton() {
    const langs = Object.keys(manifest);
    if (!langs.length) { loadBtn.disabled = true; loadBtn.textContent = "No audio packs"; return; }
    const stale = await outdatedLangs();
    loadBtn.disabled = stale.length === 0;
    const anyLoaded = langs.some((l) => !stale.includes(l));
    loadBtn.textContent = stale.length === 0 ? "Audio up to date" : (anyLoaded ? "Update audio" : "Load audio");
  }

  loadBtn.addEventListener("click", async () => {
    const stale = await outdatedLangs();
    if (!stale.length) return;
    importStatus.textContent = "Loading…";
    try {
      await requestPersist();
      const versions = { ...(loadState().audioPackVersions || {}) };
      let matched = 0, unmatched = 0, packs = 0;
      for (const lang of stale) {
        let res;
        try { res = await fetch(`public/audio/${lang}.zip`, { cache: "reload" }); }
        catch { continue; }
        if (!res.ok) continue;
        const r = await importAudioZip(await res.arrayBuffer());
        matched += r.matched; unmatched += r.unmatched; packs++;
        versions[lang] = manifest[lang].version;
      }
      const st = loadState(); st.audioPackVersions = versions; saveState(st);
      importStatus.textContent = packs
        ? `Loaded ${matched} clip${matched === 1 ? "" : "s"} from ${packs} pack${packs === 1 ? "" : "s"}${unmatched ? ` · ${unmatched} unmatched` : ""}`
        : "No bundled audio packs found";
      refreshLoadButton();
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
    importStatus.textContent = "Reading…";
    try {
      await requestPersist();
      const { matched, unmatched, skipped } = await importAudioZip(file, (done, total) => {
        importStatus.textContent = `Importing… ${done}/${total} (${Math.round((done / total) * 100)}%)`;
      });
      if (matched === 0 && skipped && skipped.length) {
        importStatus.textContent = `Already imported (${skipped.join(", ")}) — up to date`;
      } else {
        importStatus.textContent = `Imported ${matched} clip${matched === 1 ? "" : "s"}`
          + (skipped && skipped.length ? ` · ${skipped.join(", ")} already up to date` : "")
          + (unmatched ? ` · ${unmatched} unmatched` : "");
      }
      await refreshMeta();
    } catch (err) {
      importStatus.textContent = `Import failed: ${err.message}`;
    }
  });
  clearBtn.addEventListener("click", async () => {
    await clearAllClips();
    const st = loadState(); st.audioPackVersions = {}; saveState(st);
    importStatus.textContent = "Cleared all audio";
    refreshLoadButton();
    await refreshMeta();
  });

  // Initial fill: fetch the (cheap) manifest first — it drives both the Load
  // button and the per-voice tally — then run the heavier per-schema count.
  loadBtn.disabled = true;
  loadBtn.textContent = "Load audio";
  fetchAudioManifest().then((m) => { manifest = m; refreshLoadButton(); refreshMeta(); });

  backBtn.addEventListener("click", closeOverlay);

  // Escape closes the page (back to cards). Self-removes once detached.
  function onEscClose(event) {
    if (!root.isConnected) { document.removeEventListener("keydown", onEscClose); return; }
    if (event.key === "Escape") { event.preventDefault(); closeOverlay(); }
  }
  document.addEventListener("keydown", onEscClose);

  return root;
}
