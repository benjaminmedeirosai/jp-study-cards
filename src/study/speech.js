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
  const voice = voices.find((item) => String(item.lang || "").toLowerCase() === utterance.lang.toLowerCase())
    || voices.find((item) => String(item.lang || "").toLowerCase().startsWith(langPrefix));
  if (voice) utterance.voice = voice;

  window.speechSynthesis.speak(utterance);
}
