// History-API router.
//
// The browser back/forward stack represents the sequence of (deck, filter)
// states the user has dwelled on in the cards view — that pair is the only
// "page". Sets and the current card index are transient continuation, kept in
// localStorage and never pushed. Settings and Decks are transient modal entries:
// opening one pushes an entry so the browser/OS back button closes it, and you
// never land *on* one by going back from cards (they only exist while open).
//
// The URL hash carries the cards state: `#/?lib=<library>&deck=<id>&q=<filter>` —
// (library, deck, filter) is the navigable "page", so back/forward moves between
// libraries too. Overlays are `#/settings` / `#/decks` / `#/library`.
// history.state mirrors the hash for popstate restores.

import { renderCardPage } from "../ui/cardPage.js";
import { renderSettingsPage } from "../ui/settingsPage.js";
import { renderDeckPage } from "../ui/deckPage.js";
import { renderLibraryPage } from "../ui/libraryPage.js";
import { loadState, saveState, setLibrary } from "./shared.js";
import { endSession } from "./filters.js";

const app = document.getElementById("app");
let view = "cards"; // "cards" | "settings" | "decks" | "library"

// --- URL <-> state ----------------------------------------------------------
function cardsHash(lib, deck, q) {
  const params = new URLSearchParams();
  if (lib) params.set("lib", lib);
  if (deck) params.set("deck", deck);
  if (q) params.set("q", q);
  const search = params.toString();
  return `#/${search ? `?${search}` : ""}`;
}

// The current live cards state, as a history.state object + matching hash.
function cardsEntry() {
  const s = loadState();
  return { state: { view: "cards", lib: s.libraryId, deck: s.deckId, q: s.query }, hash: cardsHash(s.libraryId, s.deckId, s.query) };
}

function parseHash() {
  const hash = location.hash || "#/";
  if (hash.startsWith("#/settings")) return { view: "settings" };
  if (hash.startsWith("#/decks")) return { view: "decks" };
  if (hash.startsWith("#/library")) return { view: "library" };
  const qi = hash.indexOf("?");
  const params = new URLSearchParams(qi >= 0 ? hash.slice(qi + 1) : "");
  return { view: "cards", lib: params.get("lib") || "", deck: params.get("deck") || "", q: params.get("q") || "" };
}

// Make (library, deck, filter) the live cards state, resetting the transient
// set/card position (a library/deck/filter change always starts fresh). Switches
// the active library first so deck/filter land in that library's own slice.
function applyCardsState(lib, deck, q) {
  if (lib) setLibrary(lib);
  const state = loadState();
  const deckId = String(deck || "");
  const query = String(q || "");
  // Only reset the transient set/position when the (deck, filter) actually
  // changes. Navigating *back* to a library whose saved deck/filter already
  // matches the target should resume its set + card (kept in its own slice),
  // not jump to the top.
  const same = state.deckId === deckId && state.query === query;
  state.deckId = deckId;
  state.query = query;
  if (!same) {
    state.setId = "all";
    state.currentIndex = 0;
    state.currentKey = "";
  }
  saveState(state);
}

// --- Mounting ---------------------------------------------------------------
// A live card page kept alive (detached, paused) behind a Decks/Library overlay,
// so closing that overlay with no change restores it instantly instead of
// re-mounting (which reloads the bundle and flashes "Choose deck"). Identified
// by the (library, deck, filter) it was showing — a mismatch on close means the
// state changed, so we rebuild instead. Only Decks/Library stash; Settings can
// alter fonts/mode/grouping, so it always rebuilds.
let stash = null; // { el, key }
const STASHABLE = ["decks", "library"];
function cardsStateKey() {
  const s = loadState();
  return `${s.libraryId}|${s.deckId}|${s.query}`;
}
function discardStash() {
  if (stash && stash.el && typeof stash.el._teardown === "function") { try { stash.el._teardown(); } catch { /* ignore */ } }
  stash = null;
}

function renderView() {
  if (view === "settings") return renderSettingsPage();
  if (view === "decks") return renderDeckPage();
  if (view === "library") return renderLibraryPage();
  return renderCardPage(); // the card page opens its own study session on mount
}

// Full (re)mount: tear down whatever's mounted (and any stashed page), rebuild.
function mount() {
  // Let the outgoing page release resources before it's detached — the card
  // page uses this to stop playback / the media session (its audio elements are
  // detached <audio> objects that would otherwise keep looping after removal).
  const prev = app.firstElementChild;
  if (prev && typeof prev._teardown === "function") { try { prev._teardown(); } catch { /* ignore */ } }
  discardStash();
  app.innerHTML = "";
  app.append(renderView());
}

// Render an overlay on top of the current page. For Decks/Library, keep the
// card page alive (paused + detached) so closing restores it without a re-mount;
// otherwise (Settings, or no live card page) tear down for a clean rebuild.
function showOverlay(next) {
  const el = app.firstElementChild;
  if (STASHABLE.includes(next) && view === "cards" && el) {
    if (typeof el._pause === "function") { try { el._pause(); } catch { /* ignore */ } }
    stash = { el, key: cardsStateKey() };
    el.remove(); // detach WITHOUT teardown — we intend to restore it
  } else {
    if (el && typeof el._teardown === "function") { try { el._teardown(); } catch { /* ignore */ } }
    discardStash();
    app.innerHTML = "";
  }
  view = next;
  app.append(renderView());
}

// Return to the cards view after an overlay. Restore the stashed (still-live)
// card page when the live state still matches it (no flash); else rebuild.
function returnToCards() {
  view = "cards";
  if (stash && stash.key === cardsStateKey()) {
    app.innerHTML = ""; // drop the overlay
    app.append(stash.el);
    if (typeof stash.el._resume === "function") { try { stash.el._resume(); } catch { /* ignore */ } }
    stash = null;
  } else {
    mount();
  }
}

// --- Cards-state history (called by the card page after an in-place change) -
// The card page applies the filter and re-renders in place; these just record
// the new state in history so back/forward can return to it.
export function pushCardsURL() {
  const { state, hash } = cardsEntry();
  history.pushState(state, "", hash);
}
export function replaceCardsURL() {
  const { state, hash } = cardsEntry();
  history.replaceState(state, "", hash);
}

// --- Overlays ---------------------------------------------------------------
// Open Settings / Decks as a modal entry on top of the current cards state.
export function openOverlay(next) {
  endSession();
  history.pushState({ view: next }, "", `#/${next}`);
  showOverlay(next);
}

// Close the current overlay — identical to the browser/OS back button.
export function closeOverlay() {
  history.back();
}

// Choose a deck from the Decks overlay: replace the modal entry with the new
// cards state, so it sits above the pre-overlay cards entry (which stays as the
// back target) and the picker doesn't linger in history.
export function chooseDeck(deckId) {
  const s = loadState();
  applyCardsState(s.libraryId, deckId, s.query);
  replaceCardsURL();
  returnToCards(); // same deck re-picked → restore the live page; changed → rebuild
}

// Choose a library from the Library overlay: switch the active library, then
// replace the modal entry with that library's own saved cards state (its deck/
// filter). The pre-overlay entry stays below as the back target, so back/forward
// navigates between libraries.
export function chooseLibrary(libraryId) {
  setLibrary(libraryId);
  replaceCardsURL();
  returnToCards(); // same library re-picked → restore the live page; changed → rebuild
}

// Cross-schema jump-and-filter: switch to another library, point it at a deck,
// and apply a filter — as a NEW history entry so Back returns to where you came
// from (e.g. Farsi alphabet → tap a form → land in Farsi Words filtered to that
// letter's position; Back returns to the letter).
export function filterInLibrary(libraryId, deckId, query) {
  applyCardsState(libraryId, deckId, query);
  view = "cards";
  pushCardsURL();
  mount();
}

// --- popstate ---------------------------------------------------------------
const OVERLAY_VIEWS = ["settings", "decks", "library"];
function onPopState(event) {
  endSession();
  const target = event.state || parseHash();
  if (OVERLAY_VIEWS.includes(target.view)) {
    // Going forward into an overlay (e.g. re-opening a just-closed one).
    showOverlay(target.view);
    return;
  }
  if (OVERLAY_VIEWS.includes(view)) {
    // Backing out of an overlay: close it and show cards reflecting the current
    // live state (so a filter edited inside the overlay is honored), normalizing
    // the entry we landed on to match. Restores the kept page when unchanged.
    replaceCardsURL();
    returnToCards();
    return;
  }
  // Genuine back/forward between cards states: restore that snapshot (including
  // its library, so back/forward switches libraries).
  applyCardsState(target.lib, target.deck, target.q);
  view = "cards";
  mount();
}

export function startRouter() {
  const parsed = parseHash();
  if (parsed.view === "cards") {
    // A deep link to a DIFFERENT (library, deck, filter) than the saved one seeds
    // fresh cards state (resetting the transient set/index). A plain reload, whose
    // URL merely mirrors the saved state, resumes set/index from localStorage —
    // applyCardsState would otherwise reset them. Either way normalize the pair.
    const saved = loadState();
    const differs = parsed.deck !== saved.deckId || parsed.q !== saved.query
      || (parsed.lib && parsed.lib !== saved.libraryId);
    if (location.hash.includes("?") && differs) {
      applyCardsState(parsed.lib || saved.libraryId, parsed.deck, parsed.q);
    }
    view = "cards";
    replaceCardsURL();
  } else {
    // Deep-linked straight to an overlay: seed a cards base beneath it so back
    // closes the overlay to cards rather than exiting the app.
    const { state, hash } = cardsEntry();
    history.replaceState(state, "", hash);
    view = parsed.view;
    history.pushState({ view: parsed.view }, "", `#/${parsed.view}`);
  }
  mount();
  window.addEventListener("popstate", onPopState);
}
