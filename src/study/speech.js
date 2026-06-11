export function speak(text, options = {}) {
  const value = String(text || "").trim();
  if (!value || !("speechSynthesis" in window)) return;

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(value.normalize("NFD").replace(/[\u0300-\u036f]/g, ""));
  utterance.lang = options.lang || "ja-JP";
  utterance.rate = Number.isFinite(Number(options.rate)) ? Number(options.rate) : 0.9;
  utterance.pitch = Number.isFinite(Number(options.pitch)) ? Number(options.pitch) : 1;
  utterance.volume = Number.isFinite(Number(options.volume)) ? Number(options.volume) : 1;

  const voices = window.speechSynthesis.getVoices?.() || [];
  const langPrefix = utterance.lang.split("-")[0].toLowerCase();
  // Honor a saved voice name ONLY when it matches the utterance language, so a
  // stored Japanese voice never gets used for, say, a Spanish utterance — it
  // falls back to a language-matched voice instead.
  const preferred = options.voiceName
    ? voices.find((item) => item.name === options.voiceName && String(item.lang || "").toLowerCase().startsWith(langPrefix))
    : null;
  const voice = preferred
    || voices.find((item) => String(item.lang || "").toLowerCase() === utterance.lang.toLowerCase())
    || voices.find((item) => String(item.lang || "").toLowerCase().startsWith(langPrefix));
  if (voice) utterance.voice = voice;

  window.speechSynthesis.speak(utterance);
}

// Voices for a language prefix (default Japanese). Note: getVoices() is often
// empty until the browser fires `voiceschanged` — subscribe via onVoicesChanged.
export function getVoicesForLang(prefix = "ja") {
  const voices = window.speechSynthesis?.getVoices?.() || [];
  const needle = prefix.toLowerCase();
  return voices.filter((voice) => String(voice.lang || "").toLowerCase().startsWith(needle));
}

export function onVoicesChanged(handler) {
  if (!("speechSynthesis" in window)) return () => {};
  window.speechSynthesis.addEventListener("voiceschanged", handler);
  return () => window.speechSynthesis.removeEventListener("voiceschanged", handler);
}
