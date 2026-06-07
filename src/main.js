import { renderCardPage } from "./study/cardPage.js";
import { renderSettingsPage } from "./study/settingsPage.js";
import { renderDeckPage } from "./study/deckPage.js";

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
    await navigator.serviceWorker.register("/sw.js");
  } catch (error) {
    console.warn("Service worker registration failed", error);
  }
}

window.addEventListener("hashchange", mount);
mount();
void registerServiceWorker();
