// Study-session timing + usage-gated history (filter terms and deck selections),
// plus a small history-dropdown UI shared by the filter inputs.
//
// A "session" is time spent on the card page studying one (deck, filter) pair.
// It opens when the card page mounts and closes on navigation away / tab hide.
// Only sessions of at least MIN_MS count toward history, so quickly typing a
// filter or briefly opening a deck never pollutes the lists.

import { loadState, saveState } from "./shared.js";

const SESSION_KEY = "jp-study-cards-session-v1";
const MIN_MS = 10_000;            // must study ≥ 10s to be remembered
const MAX_MS = 2 * 60 * 60_000;   // cap a single session (guards stale/idle)
const PROTECT_MS = 5 * 60_000;    // ≥ 5 min of study is protected from eviction
export const MAX_HISTORY = 20;

// ---------------------------------------------------------------------------
// Session timing
// ---------------------------------------------------------------------------

function readSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); } catch { return null; }
}
function writeSession(s) { try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch {} }
function clearSession() { try { localStorage.removeItem(SESSION_KEY); } catch {} }

// Open a session for the given deck + filter. Flushes any prior one first.
export function beginSession(deckId, label, query) {
  endSession();
  const id = String(deckId || "");
  const q = String(query || "").trim();
  if (!id && !q) return; // nothing worth timing
  writeSession({ deckId: id, label: String(label || ""), query: q, startedAt: Date.now(), accumMs: 0, hidden: !!document.hidden });
}

// Pause/resume so a backgrounded tab doesn't inflate study time.
export function pauseSession() {
  const s = readSession();
  if (!s || s.hidden) return;
  s.accumMs = (s.accumMs || 0) + (Date.now() - s.startedAt);
  s.hidden = true;
  writeSession(s);
}
export function resumeSession() {
  const s = readSession();
  if (!s || !s.hidden) return;
  s.startedAt = Date.now();
  s.hidden = false;
  writeSession(s);
}

// Close the session and, if it ran long enough, commit it to history.
export function endSession() {
  const s = readSession();
  if (!s) return;
  clearSession();
  let ms = (s.accumMs || 0) + (s.hidden ? 0 : Date.now() - s.startedAt);
  if (!Number.isFinite(ms) || ms < MIN_MS) return;
  if (ms > MAX_MS) ms = MAX_MS;
  const state = loadState();
  if (s.deckId) upsert(state.deckHistory, "id", s.deckId, { id: s.deckId, label: s.label, ms });
  if (s.query) upsert(state.filterHistory, "q", s.query, { q: s.query, ms });
  saveState(state);
}

// Accumulate ms onto an existing entry (or add it), refresh recency, cap length.
// Eviction when over capacity: drop the oldest entry studied under PROTECT_MS
// first (low-value), and only fall back to plain FIFO once every remaining
// entry is at/over the protect threshold.
function upsert(arr, key, value, fields) {
  const now = Date.now();
  const existing = arr.find((e) => e[key] === value);
  if (existing) {
    existing.ms = (existing.ms || 0) + fields.ms;
    existing.at = now;
    if (fields.label) existing.label = fields.label;
  } else {
    arr.push({ ...fields, at: now });
  }
  while (arr.length > MAX_HISTORY) {
    const weak = arr.filter((e) => (e.ms || 0) < PROTECT_MS);
    const pool = weak.length ? weak : arr;
    let victim = pool[0];
    for (const e of pool) if (e.at < victim.at) victim = e;
    arr.splice(arr.indexOf(victim), 1);
  }
}

// ---------------------------------------------------------------------------
// History accessors + formatting
// ---------------------------------------------------------------------------

export function getFilterHistory() {
  return loadState().filterHistory.slice().sort((a, b) => b.at - a.at);
}
export function getDeckHistory() {
  return loadState().deckHistory.slice().sort((a, b) => b.at - a.at);
}

export function formatDuration(ms) {
  const min = Math.max(1, Math.round(ms / 60_000));
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function formatAgo(at) {
  const min = Math.floor(Math.max(0, Date.now() - at) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ---------------------------------------------------------------------------
// History dropdown UI
// ---------------------------------------------------------------------------

const CHEVRON = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m6 9 6 6 6-6"/></svg>`;

// Wrap an <input> with a right-aligned dropdown button + history panel.
// getItems() → [{ primary, meta, value }]; onPick(item) fires on selection.
// Returns the wrapper element (the input is moved inside it).
export function historyDropdown(input, { getItems, onPick, emptyText = "Nothing studied yet" }) {
  const wrap = document.createElement("div");
  wrap.className = "filter-wrap";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "filter-dd-btn";
  btn.setAttribute("aria-label", "Show history");
  btn.setAttribute("aria-expanded", "false");
  btn.innerHTML = CHEVRON;

  const panel = document.createElement("div");
  panel.className = "filter-dd-panel";
  panel.hidden = true;

  wrap.append(input, btn, panel);

  const onDocPointer = (e) => { if (!wrap.contains(e.target)) close(); };
  // Capture-phase Escape: closes the panel and stops the event before it can
  // reach a page-level handler (so Esc closes the dropdown, not the page).
  const onDocKey = (e) => { if (e.key === "Escape" && !panel.hidden) { e.stopPropagation(); close(); } };

  function close() {
    if (panel.hidden) return;
    panel.hidden = true;
    btn.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", onDocPointer, true);
    document.removeEventListener("keydown", onDocKey, true);
  }

  function open() {
    const items = getItems() || [];
    panel.innerHTML = "";
    if (!items.length) {
      const em = document.createElement("div");
      em.className = "filter-dd-empty";
      em.textContent = emptyText;
      panel.append(em);
    } else {
      for (const it of items) {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "filter-dd-item";
        const main = document.createElement("span");
        main.className = "filter-dd-main";
        main.textContent = it.primary;
        const meta = document.createElement("span");
        meta.className = "filter-dd-meta";
        meta.textContent = it.meta;
        row.append(main, meta);
        row.addEventListener("click", () => { onPick(it); close(); });
        panel.append(row);
      }
    }
    panel.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    document.addEventListener("pointerdown", onDocPointer, true);
    document.addEventListener("keydown", onDocKey, true);
  }

  btn.addEventListener("click", () => { panel.hidden ? open() : close(); });
  return wrap;
}
