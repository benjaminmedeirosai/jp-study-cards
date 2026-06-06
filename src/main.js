import { renderJapaneseStudyPage } from "./study/japaneseStudy.js?v=22";

const app = document.getElementById("app");

function mount() {
  app.innerHTML = "";
  app.append(renderJapaneseStudyPage());
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("/sw.js");
  } catch (error) {
    console.warn("Service worker registration failed", error);
  }
}

mount();
void registerServiceWorker();
