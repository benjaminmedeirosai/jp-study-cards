// Library picker overlay (reached via #/library): choose a language, then a
// schema within it (Japanese → Words / Kanji; Spanish → Words). Mirrors the deck
// page's shell + list styling. Selecting a schema switches the active one and
// returns to the cards view.
//
// This page is also where offline audio is imported: one .zip populates every
// deck it covers, and each schema row shows its total entries + how many have
// an audio clip.

import { loadState, saveState, button } from "../core/shared.js";
import { libraryGroups } from "../core/libraries.js";
import { chooseLibrary, closeOverlay } from "../core/router.js";
import { importAudioZip, clipKeyForEntry, allClipKeys, clearAllClips, clearClips, countClips, getAudioMeta, requestPersist, fetchAudioManifest } from "../audio/audioStore.js";

// Per-schema noun for the entry count.
const KIND_NOUN = { word: "words", kanji: "kanji", alpha: "letters", harakat: "marks" };

// Computed library meta (per-schema tallies, per-language size/source, Load
// button state), cached across opens. The underlying audio inventory only
// changes via this page's own import / load / clear actions — each recomputes
// and refreshes this cache — so reopening can apply it instantly with zero
// IndexedDB reads or bundle fetches (the slow part, very noticeable on phones).
// In-memory only: a full app reload (e.g. after a new build) starts it fresh.
let metaCache = null;

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
      await recompute();
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
  // Write a computed cache object onto this render's DOM elements. Synchronous
  // and cheap — this is the whole point of the cache: a reopen is just this.
  function applyMeta(cache) {
    for (const { language, schemas } of groups) {
      const li = cache.langs[language.id];
      const sizeEl = langSizeEls.get(language.id);
      if (sizeEl && li) sizeEl.textContent = li.sizeText;
      const srcEl = langSrcEls.get(language.id);
      if (srcEl && li) { srcEl.textContent = li.srcText; srcEl.classList.toggle("is-imported", li.isImported); }
      const clearOne = langClearEls.get(language.id);
      if (clearOne && li) clearOne.hidden = !li.loaded;
      for (const lib of schemas) {
        const el = metaEls.get(lib.id);
        const si = cache.schemas[lib.id];
        if (!el || !si) continue;
        el.textContent = si.text;
        el.classList.toggle("full-audio", si.full);
        el.classList.toggle("partial-audio", si.partial);
      }
    }
    if (cache.load) { loadBtn.disabled = cache.load.disabled; loadBtn.textContent = cache.load.text; }
  }

  // The heavy path: read clip keys + each bundle + per-language clip presence
  // once, fold it into a plain cache object, store it module-side, and apply.
  // Called on first open and after every mutating action (import/load/clear).
  async function recompute() {
    const keySet = await allClipKeys();
    const loadedVersions = loadState().audioPackVersions || {};
    const cache = { manifest, langs: {}, schemas: {}, load: null };
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
      // Per-language audio footprint, shown only when this language has clips
      // stored. Byte totals are declared in the manifest / voices.json.
      const totalBytes = Object.values(voices).reduce((a, v) => a + (v.bytes || 0), 0);
      // Source tag: "Library" packs are published (in the manifest) and
      // re-loadable; others are manual imports.
      const published = !!manifest[language.id];
      cache.langs[language.id] = {
        loaded,
        sizeText: loaded && totalBytes ? ` · ${formatBytes(totalBytes)}` : "",
        srcText: published ? "Library" : (loaded ? "Imported" : "Import only"),
        isImported: !published
      };
      for (const lib of schemas) {
        if (!bundle) { cache.schemas[lib.id] = { text: "", full: false, partial: false }; continue; }
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
        cache.schemas[lib.id] = {
          text: `${total} ${noun}` + (parts.length ? ` · ${parts.join(" · ")}` : (total ? " · no audio" : "")),
          full: parts.length > 0 && !anyPartial,
          partial: parts.length > 0 && anyPartial
        };
      }
    }
    // Load button: stale = published packs whose loaded version differs OR that
    // have no clips in storage. Reuses the per-language `loaded` already read.
    const packLangs = Object.keys(manifest);
    if (!packLangs.length) {
      cache.load = { disabled: true, text: "No audio packs" };
    } else {
      const stale = packLangs.filter((lang) =>
        loadedVersions[lang] !== manifest[lang].version || !(cache.langs[lang] && cache.langs[lang].loaded));
      const anyLoaded = packLangs.some((l) => !stale.includes(l));
      cache.load = { disabled: stale.length === 0, text: stale.length === 0 ? "Audio up to date" : (anyLoaded ? "Update audio" : "Load audio") };
    }
    metaCache = cache;
    applyMeta(cache);
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
      await recompute();
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
      await recompute();
    } catch (err) {
      importStatus.textContent = `Import failed: ${err.message}`;
    }
  });
  clearBtn.addEventListener("click", async () => {
    await clearAllClips();
    const st = loadState(); st.audioPackVersions = {}; saveState(st);
    importStatus.textContent = "Cleared all audio";
    await recompute();
  });

  // Initial fill. If we've computed before this session, apply the cache
  // synchronously — no IndexedDB reads, no bundle fetches — so reopening is
  // instant (the slow part on phones). Otherwise fetch the (cheap) manifest,
  // then run the one-time heavy compute that fills + caches everything.
  loadBtn.disabled = true;
  loadBtn.textContent = "Load audio";
  if (metaCache) {
    manifest = metaCache.manifest || {};
    applyMeta(metaCache);
  } else {
    fetchAudioManifest().then((m) => { manifest = m; recompute(); });
  }

  backBtn.addEventListener("click", closeOverlay);

  // Escape closes the page (back to cards). Self-removes once detached.
  function onEscClose(event) {
    if (!root.isConnected) { document.removeEventListener("keydown", onEscClose); return; }
    if (event.key === "Escape") { event.preventDefault(); closeOverlay(); }
  }
  document.addEventListener("keydown", onEscClose);

  return root;
}
