import { renderCardPage } from "./study/cardPage.js";
import { renderSettingsPage } from "./study/settingsPage.js";
import { renderDeckPage } from "./study/deckPage.js";
import { endSession, pauseSession, resumeSession } from "./study/filters.js";

const app = document.getElementById("app");

function mount() {
  app.innerHTML = "";
  const hash = location.hash;
  if (hash.startsWith("#/settings")) app.append(renderSettingsPage());
  else if (hash.startsWith("#/decks")) app.append(renderDeckPage());
  else app.append(renderCardPage());
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("sw.js");
  } catch (error) {
    console.warn("Service worker registration failed", error);
  }
}

// Close any open study session when leaving the card page (the card page
// reopens one on mount). pagehide covers tab close/reload; visibility pauses
// the timer so a backgrounded tab doesn't inflate study time.
window.addEventListener("hashchange", () => { endSession(); mount(); });
window.addEventListener("pagehide", () => { endSession(); });
document.addEventListener("visibilitychange", () => {
  if (document.hidden) pauseSession();
  else resumeSession();
});
mount();
void registerServiceWorker();
