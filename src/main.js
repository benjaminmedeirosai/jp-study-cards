import { startRouter } from "./study/router.js";
import { endSession, pauseSession, resumeSession } from "./study/filters.js";

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("sw.js");
  } catch (error) {
    console.warn("Service worker registration failed", error);
  }
}

// Navigation (and thus session start/stop on deck+filter transitions) is owned
// by the router. pagehide covers tab close/reload; visibility pauses the timer
// so a backgrounded tab doesn't inflate study time.
window.addEventListener("pagehide", () => { endSession(); });
document.addEventListener("visibilitychange", () => {
  if (document.hidden) pauseSession();
  else resumeSession();
});
startRouter();
void registerServiceWorker();
