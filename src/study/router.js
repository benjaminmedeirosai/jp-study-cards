// History-API router.
//
// The browser back/forward stack represents the sequence of (deck, filter)
// states the user has dwelled on in the cards view — that pair is the only
// "page". Sets and the current card index are transient continuation, kept in
// localStorage and never pushed. Settings and Decks are transient modal entries:
// opening one pushes an entry so the browser/OS back button closes it, and you
// never land *on* one by going back from cards (they only exist while open).
//
// The URL hash carries the cards state: `#/?deck=<id>&q=<filter>`; overlays are
// `#/settings` / `#/decks`. history.state mirrors it for popstate restores.

import { renderCardPage } from "./cardPage.js";
import { renderSettingsPage } from "./settingsPage.js";
import { renderDeckPage } from "./deckPage.js";
import { loadState, saveState } from "./shared.js";
import { endSession } from "./filters.js";

const app = document.getElementById("app");
let view = "cards"; // "cards" | "settings" | "decks"

// --- URL <-> state ----------------------------------------------------------
function cardsHash(deck, q) {
  const params = new URLSearchParams();
  if (deck) params.set("deck", deck);
  if (q) params.set("q", q);
  const search = params.toString();
  return `#/${search ? `?${search}` : ""}`;
}

function parseHash() {
  const hash = location.hash || "#/";
  if (hash.startsWith("#/settings")) return { view: "settings" };
  if (hash.startsWith("#/decks")) return { view: "decks" };
  const qi = hash.indexOf("?");
  const params = new URLSearchParams(qi >= 0 ? hash.slice(qi + 1) : "");
  return { view: "cards", deck: params.get("deck") || "", q: params.get("q") || "" };
}

// Write a (deck, filter) into localStorage as the live cards state, resetting the
// transient set/card position (a deck or filter change always starts fresh).
function applyCardsState(deck, q) {
  const state = loadState();
  state.deckId = String(deck || "");
  state.query = String(q || "");
  state.setId = "all";
  state.currentIndex = 0;
  saveState(state);
}

// --- Mounting ---------------------------------------------------------------
function mount() {
  app.innerHTML = "";
  if (view === "settings") app.append(renderSettingsPage());
  else if (view === "decks") app.append(renderDeckPage());
  else app.append(renderCardPage()); // the card page opens its own study session on mount
}

// --- Cards-state history (called by the card page after an in-place change) -
// The card page applies the filter and re-renders in place; these just record
// the new state in history so back/forward can return to it.
export function pushCardsURL() {
  const s = loadState();
  history.pushState({ view: "cards", deck: s.deckId, q: s.query }, "", cardsHash(s.deckId, s.query));
}
export function replaceCardsURL() {
  const s = loadState();
  history.replaceState({ view: "cards", deck: s.deckId, q: s.query }, "", cardsHash(s.deckId, s.query));
}

// --- Overlays ---------------------------------------------------------------
// Open Settings / Decks as a modal entry on top of the current cards state.
export function openOverlay(next) {
  endSession();
  view = next;
  history.pushState({ view: next }, "", `#/${next}`);
  mount();
}

// Close the current overlay — identical to the browser/OS back button.
export function closeOverlay() {
  history.back();
}

// Choose a deck from the Decks overlay: replace the modal entry with the new
// cards state, so it sits above the pre-overlay cards entry (which stays as the
// back target) and the picker doesn't linger in history.
export function chooseDeck(deckId) {
  applyCardsState(deckId, loadState().query);
  view = "cards";
  const s = loadState();
  history.replaceState({ view: "cards", deck: s.deckId, q: s.query }, "", cardsHash(s.deckId, s.query));
  mount();
}

// --- popstate ---------------------------------------------------------------
function onPopState(event) {
  endSession();
  const target = event.state || parseHash();
  if (target.view === "settings" || target.view === "decks") {
    // Going forward into an overlay (e.g. re-opening a just-closed one).
    view = target.view;
    mount();
    return;
  }
  if (view === "settings" || view === "decks") {
    // Backing out of an overlay: close it and show cards reflecting the current
    // live state (so a filter edited inside the overlay is honored), normalizing
    // the entry we landed on to match.
    view = "cards";
    replaceCardsURL();
    mount();
    return;
  }
  // Genuine back/forward between cards states: restore that snapshot.
  applyCardsState(target.deck, target.q);
  view = "cards";
  mount();
}

export function startRouter() {
  const parsed = parseHash();
  if (parsed.view === "cards") {
    // A deep link to a DIFFERENT (deck, filter) than the saved one seeds fresh
    // cards state (resetting the transient set/index). A plain reload, whose URL
    // merely mirrors the saved state, resumes set/index from localStorage —
    // applyCardsState would otherwise reset them. Either way normalize the pair.
    const saved = loadState();
    if (location.hash.includes("?") && (parsed.deck !== saved.deckId || parsed.q !== saved.query)) {
      applyCardsState(parsed.deck, parsed.q);
    }
    view = "cards";
    replaceCardsURL();
  } else {
    // Deep-linked straight to an overlay: seed a cards base beneath it so back
    // closes the overlay to cards rather than exiting the app.
    const s = loadState();
    history.replaceState({ view: "cards", deck: s.deckId, q: s.query }, "", cardsHash(s.deckId, s.query));
    view = parsed.view;
    history.pushState({ view: parsed.view }, "", `#/${parsed.view}`);
  }
  mount();
  window.addEventListener("popstate", onPopState);
}
