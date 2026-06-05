const app = document.getElementById("app");

function renderScaffold() {
  app.innerHTML = `
    <section class="lite-shell">
      <div class="lite-card">
        <h1>Japanese Study Lite</h1>
        <p>Static PWA scaffold is ready. Next step: port the study page and load generated decks.</p>
        <button id="resync-cache" type="button">Resync offline cache</button>
        <p id="cache-status" class="status"></p>
      </div>
    </section>
  `;

  document.getElementById("resync-cache")?.addEventListener("click", resyncOfflineCache);
}

function setCacheStatus(message) {
  const status = document.getElementById("cache-status");
  if (status) status.textContent = message;
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("/sw.js");
    navigator.serviceWorker.addEventListener("message", (event) => {
      if (event.data?.type !== "RESYNC_CACHE_RESULT") return;
      if (event.data.ok) setCacheStatus(`Offline cache resynced (${event.data.count} files).`);
      else setCacheStatus(`Offline cache resync failed: ${event.data.error}`);
    });
  } catch (error) {
    console.warn("Service worker registration failed", error);
  }
}

async function resyncOfflineCache() {
  if (!("serviceWorker" in navigator)) {
    setCacheStatus("Service workers are not supported in this browser.");
    return;
  }

  setCacheStatus("Resyncing offline cache...");
  const registration = await navigator.serviceWorker.ready;
  registration.active?.postMessage({ type: "RESYNC_CACHE" });
}

renderScaffold();
void registerServiceWorker();
