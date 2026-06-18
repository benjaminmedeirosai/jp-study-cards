// Voice-capture widget — record your own pronunciation for a card, review it on
// a waveform, trim the dead air off each end, and save it as a "My recording"
// take. Multiple takes per card are kept; you pick which one is active (the one
// that plays). Saved takes can be re-opened and re-trimmed. Opens from the mic
// button in the card's mini tray.
//
// Capture: getUserMedia → MediaRecorder (webm/opus). A live AnalyserNode drives
// a scrolling volume graph + a millisecond timer. On stop the blob is decoded to
// an AudioBuffer for the trim/preview view; saving slices that buffer between the
// trim handles and re-encodes to WAV (deterministic, universally playable).
//
// "Keep trimmed audio" stores the untrimmed buffer alongside the clip so a later
// re-edit can re-extend the trim (lossless); off by default (trimmed clip only,
// so re-edit can only trim further). "Normalize" peak-scales the saved clip.

import {
  listRecordings, getRecordingBlob, getRecordingSource,
  addRecording, updateRecording, setActiveRecording, deleteRecording
} from "../audio/audioStore.js";

const GREEN = "#4ade80";
const HOT_COLOR = "#fbbf24";   // amber: signal getting hot
const CLIP_COLOR = "#f87171";  // red: near full-scale, likely clipping
const HOT_AT = 0.85;           // ≥ this fraction of full scale → amber
const CLIP_AT = 0.99;          // ≥ this → red (clipping risk)
// Normalization target: scale the trimmed peak to this (not 1.0). Leaves
// headroom and matches the ~0.7–0.8 peak the macOS `say` clips sit at, so a
// recording and a generated clip play back at a comparable loudness.
const NORM_TARGET = 0.8;
// Mic processing (browser AGC / noise suppression / echo cancellation). Off by
// default so capture reflects true levels — AGC would auto-ride the gain and
// make the clip meter + Normalize meaningless. Remembered across reopens within
// the session. Toggled per capture in the Record dialog before pressing Start.
let lastMicProcessing = false;

// Peak amplitude over [startSec, endSec) of an AudioBuffer (channel 0), in [0,1].
function peakOf(buffer, startSec, endSec) {
  const ch = buffer.getChannelData(0);
  const from = Math.max(0, Math.floor(startSec * buffer.sampleRate));
  const to = Math.min(ch.length, Math.floor(endSec * buffer.sampleRate));
  let p = 0;
  for (let i = from; i < to; i++) p = Math.max(p, Math.abs(ch[i]));
  return p;
}

// Encode a mono slice [startSec, endSec) of an AudioBuffer to a 16-bit PCM WAV
// Blob. Channels are downmixed (mic is mono anyway). `gain` scales samples
// (used for normalization).
function encodeWav(buffer, startSec, endSec, gain = 1) {
  const rate = buffer.sampleRate;
  const from = Math.max(0, Math.floor(startSec * rate));
  const to = Math.min(buffer.length, Math.floor(endSec * rate));
  const len = Math.max(0, to - from);
  const chans = buffer.numberOfChannels;
  const out = new Float32Array(len);
  for (let c = 0; c < chans; c++) {
    const src = buffer.getChannelData(c);
    for (let i = 0; i < len; i++) out[i] += src[from + i] / chans;
  }
  const bytes = 44 + len * 2;
  const ab = new ArrayBuffer(bytes);
  const view = new DataView(ab);
  const str = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  str(0, "RIFF"); view.setUint32(4, bytes - 8, true); str(8, "WAVE");
  str(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  str(36, "data"); view.setUint32(40, len * 2, true);
  for (let i = 0; i < len; i++) {
    const s = Math.max(-1, Math.min(1, out[i] * gain));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([ab], { type: "audio/wav" });
}

// Downsample an AudioBuffer (channel 0) to `n` peak amplitudes in [0,1].
function peaks(buffer, n) {
  const ch = buffer.getChannelData(0);
  const step = Math.max(1, Math.floor(ch.length / n));
  const out = [];
  for (let i = 0; i < n; i++) {
    let peak = 0;
    for (let j = i * step; j < Math.min((i + 1) * step, ch.length); j++) peak = Math.max(peak, Math.abs(ch[j]));
    out.push(peak);
  }
  return out;
}

function fmtAgo(ms) {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

export function openCaptureWidget({ lang, entryKey, label, onChange, getPackClips }) {
  const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#60a5fa";
  // Waveform bar color for a sample level (fraction of full scale): red near the
  // ceiling (likely clipped), amber when hot, else the normal accent.
  const levelColor = (lvl) => (lvl >= CLIP_AT ? CLIP_COLOR : lvl >= HOT_AT ? HOT_COLOR : accent);

  const backdrop = document.createElement("div");
  backdrop.className = "capture-backdrop";
  const panel = document.createElement("div");
  panel.className = "capture-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  backdrop.append(panel);

  const head = document.createElement("div");
  head.className = "capture-head";
  const title = document.createElement("div");
  title.className = "capture-title";
  title.textContent = label ? `Record · ${label}` : "Record";
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "capture-close";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.textContent = "✕";
  head.append(title, closeBtn);

  const takesEl = document.createElement("div");
  takesEl.className = "capture-takes";

  const stage = document.createElement("div");
  stage.className = "capture-stage";
  const canvas = document.createElement("canvas");
  canvas.className = "capture-canvas";
  canvas.width = 600; canvas.height = 120;
  const timer = document.createElement("div");
  timer.className = "capture-timer";
  timer.textContent = "0.00s";
  // Soft trim (blue): non-destructive playback window, stored as start/end on
  // the take. Hard trim (red): destructively cuts the stored audio file.
  const trimStartEl = document.createElement("div"); trimStartEl.className = "capture-trim capture-trim--start"; trimStartEl.hidden = true;
  const trimEndEl = document.createElement("div"); trimEndEl.className = "capture-trim capture-trim--end"; trimEndEl.hidden = true;
  const hardStartEl = document.createElement("div"); hardStartEl.className = "capture-trim capture-trim--hard capture-trim--hstart"; hardStartEl.hidden = true;
  const hardEndEl = document.createElement("div"); hardEndEl.className = "capture-trim capture-trim--hard capture-trim--hend"; hardEndEl.hidden = true;
  stage.append(canvas, timer, hardStartEl, hardEndEl, trimStartEl, trimEndEl);

  // Review option: normalize. Persisted on the take (it's a flag, not baked into
  // the kept original — re-edit restores it).
  const opts = document.createElement("div");
  opts.className = "capture-opts";
  opts.hidden = true;
  const normLabel = document.createElement("label"); normLabel.className = "capture-opt";
  const normChk = document.createElement("input"); normChk.type = "checkbox";
  normLabel.append(normChk, document.createTextNode(" Normalize volume"));
  opts.append(normLabel);

  // Idle option: mic processing. Off → raw capture (true levels for the meter +
  // Normalize); on → the browser's auto-gain/noise-suppression/echo-cancellation.
  // Chosen before Start; applies to the next capture.
  const micOpts = document.createElement("div");
  micOpts.className = "capture-opts";
  micOpts.hidden = true;
  const micLabel = document.createElement("label"); micLabel.className = "capture-opt";
  micLabel.title = "On: browser auto-gain, noise suppression, and echo cancellation. Off: raw mic — true levels (best for the clip meter).";
  const micChk = document.createElement("input"); micChk.type = "checkbox"; micChk.checked = lastMicProcessing;
  micLabel.append(micChk, document.createTextNode(" Mic processing (auto-gain / noise reduction)"));
  micOpts.append(micLabel);

  const controls = document.createElement("div");
  controls.className = "capture-controls";
  const startBtn = document.createElement("button"); startBtn.type = "button"; startBtn.className = "capture-btn capture-btn--rec"; startBtn.textContent = "● Start";
  const stopBtn = document.createElement("button"); stopBtn.type = "button"; stopBtn.className = "capture-btn capture-btn--stop"; stopBtn.textContent = "■ Stop"; stopBtn.hidden = true;
  const playBtn = document.createElement("button"); playBtn.type = "button"; playBtn.className = "capture-btn"; playBtn.textContent = "▶ Play"; playBtn.hidden = true;
  const trimBtn = document.createElement("button"); trimBtn.type = "button"; trimBtn.className = "capture-btn capture-btn--trim"; trimBtn.textContent = "✂ Trim file"; trimBtn.hidden = true;
  const saveBtn = document.createElement("button"); saveBtn.type = "button"; saveBtn.className = "capture-btn capture-btn--save"; saveBtn.textContent = "Save"; saveBtn.hidden = true;
  const discardBtn = document.createElement("button"); discardBtn.type = "button"; discardBtn.className = "capture-btn"; discardBtn.textContent = "Discard"; discardBtn.hidden = true;
  controls.append(startBtn, stopBtn, playBtn, trimBtn, saveBtn, discardBtn);

  const status = document.createElement("div");
  status.className = "capture-status";

  panel.append(head, takesEl, stage, opts, micOpts, controls, status);
  document.body.append(backdrop);

  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  let stream = null, recorder = null, analyser = null, rafId = 0;
  let chunks = [], liveVals = [], recStartTs = 0;
  let reviewBuffer = null;        // decoded AudioBuffer awaiting save (the ORIGINAL we keep)
  let trimStart = 0, trimEnd = 0; // soft trim window (seconds, in reviewBuffer coords)
  let hardStart = 0, hardEnd = 0; // hard-trim (destructive) bounds; default 0..duration
  let hardActive = false;         // red hard-trim bars shown / in use
  let previewSrc = null, previewProgress = null; // null = not previewing
  let viewBuffer = null;          // decoded clip shown read-only (play row → waveform)
  let viewProgress = null;        // 0..1 playback position for the view line
  let editId = null;              // set when re-editing an existing take
  let creatingNew = false;        // true while capturing/reviewing a brand-new take
  let focusId = null;             // the take/clip the user is working on / playing (highlighted row)
  let baseline = null;            // review state on entry, to detect unsaved changes
  let mode = "idle";              // idle | recording | review | viewing
  let packClipList = [];          // provided clips [{ voiceId, source, blob, name }], loaded once

  const ctx2d = canvas.getContext("2d");
  const clearCanvas = () => ctx2d.clearRect(0, 0, canvas.width, canvas.height);
  // status line; `warn` gives the prominent boxed style (e.g. blocked actions).
  function setStatus(msg, warn = false) { status.textContent = msg || ""; status.classList.toggle("warn", !!warn && !!msg); }

  // Faint horizontal amplitude guides (center + ±50% + ±100%) so you can gauge
  // how loud the recording is.
  function drawGrid() {
    const mid = canvas.height / 2;
    ctx2d.strokeStyle = "rgba(148,163,184,0.16)";
    ctx2d.lineWidth = 1;
    for (const a of [0.5, 1]) {
      for (const dir of [-1, 1]) {
        const y = mid + dir * a * (canvas.height / 2 - 1);
        ctx2d.beginPath(); ctx2d.moveTo(0, y); ctx2d.lineTo(canvas.width, y); ctx2d.stroke();
      }
    }
    ctx2d.strokeStyle = "rgba(148,163,184,0.28)";
    ctx2d.beginPath(); ctx2d.moveTo(0, mid); ctx2d.lineTo(canvas.width, mid); ctx2d.stroke();
  }

  function drawLive() {
    const buf = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteTimeDomainData(buf);
    let peak = 0;
    for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i] - 128) / 128);
    liveVals.push(peak);
    const maxBars = canvas.width / 3;
    if (liveVals.length > maxBars) liveVals.shift();
    clearCanvas(); drawGrid();
    const mid = canvas.height / 2;
    for (let i = 0; i < liveVals.length; i++) {
      ctx2d.fillStyle = levelColor(liveVals[i]);
      const h = Math.max(1, liveVals[i] * canvas.height);
      ctx2d.fillRect(i * 3, mid - h / 2, 2, h);
    }
    // Flash the box amber/red while the incoming level is hot/clipping (a live
    // "back off the mic" cue; cleared when we leave recording).
    canvas.classList.toggle("is-hot", peak >= HOT_AT && peak < CLIP_AT);
    canvas.classList.toggle("is-clip", peak >= CLIP_AT);
    timer.textContent = `${((performance.now() - recStartTs) / 1000).toFixed(2)}s`;
    rafId = requestAnimationFrame(drawLive);
  }

  // Normalization gain (peak of the trimmed region → NORM_TARGET), or 1 when off.
  // Applied live to the waveform, the preview, and the saved clip — so toggling
  // the checkbox lets you A/B the loudness and save whichever you prefer.
  function currentGain() {
    if (!normChk.checked || !reviewBuffer) return 1;
    const p = peakOf(reviewBuffer, trimStart, trimEnd);
    return p > 0.001 ? NORM_TARGET / p : 1;
  }

  function drawReview() {
    if (!reviewBuffer) return;
    const n = Math.floor(canvas.width / 3);
    const ps = peaks(reviewBuffer, n);
    const dur = reviewBuffer.duration;
    const mid = canvas.height / 2;
    const gain = currentGain();
    canvas.classList.remove("is-hot", "is-clip"); // live flash is recording-only
    clearCanvas(); drawGrid();
    for (let i = 0; i < ps.length; i++) {
      const t = (i / n) * dur;
      const cut = hardActive && (t < hardStart || t > hardEnd);   // will be destroyed
      const inTrim = t >= trimStart && t <= trimEnd;              // plays
      // Color the playable bars by their RAW level (pre-gain) so clipping in the
      // original capture stays visible even after normalizing it down.
      ctx2d.fillStyle = cut ? "rgba(248,113,113,0.3)" : (inTrim ? levelColor(ps[i]) : "rgba(148,163,184,0.35)");
      const h = Math.max(1, Math.min(1, ps[i] * gain) * canvas.height * 0.92);
      ctx2d.fillRect(i * 3, mid - h / 2, 2, h);
    }
    // green playback progress line
    if (previewProgress != null) {
      const t = trimStart + previewProgress * (trimEnd - trimStart);
      const x = (t / dur) * canvas.width;
      ctx2d.strokeStyle = GREEN; ctx2d.lineWidth = 2;
      ctx2d.beginPath(); ctx2d.moveTo(x, 0); ctx2d.lineTo(x, canvas.height); ctx2d.stroke();
    }
    trimStartEl.style.left = `${(trimStart / dur) * 100}%`;
    trimEndEl.style.left = `${(trimEnd / dur) * 100}%`;
    hardStartEl.style.left = `${(hardStart / dur) * 100}%`;
    hardEndEl.style.left = `${(hardEnd / dur) * 100}%`;
    const peakPct = Math.round(Math.min(1, peakOf(reviewBuffer, trimStart, trimEnd) * gain) * 100);
    timer.textContent = `${(trimEnd - trimStart).toFixed(2)}s` + (trimStart > 0 || trimEnd < dur ? ` (of ${dur.toFixed(2)}s)` : "") + ` · peak ${peakPct}%` + (normChk.checked ? " · norm" : "");
    updateDirty();
  }

  function setMode(next) {
    mode = next;
    // "viewing" = read-only waveform playback of a take or a provided clip; the
    // Start button stays available (so you can still record) but every edit
    // control is hidden.
    startBtn.hidden = next !== "idle" && next !== "viewing";
    micOpts.hidden = startBtn.hidden; // the mic-processing choice rides with Start
    stopBtn.hidden = next !== "recording";
    playBtn.hidden = saveBtn.hidden = discardBtn.hidden = opts.hidden = trimBtn.hidden = next !== "review";
    trimStartEl.hidden = trimEndEl.hidden = next !== "review";
    hardStartEl.hidden = hardEndEl.hidden = !(next === "review" && hardActive);
    trimBtn.classList.toggle("is-on", hardActive);
    closeBtn.disabled = next === "recording";
  }

  // Are there unsaved changes in the current review? A brand-new capture always
  // counts; an edit counts only once trim/normalize/keep differ from where it
  // was opened.
  function isDirty() {
    if (creatingNew) return true;
    if (editId == null || !baseline) return false;
    const hardCut = hardActive && (hardStart > 0.001 || hardEnd < reviewBuffer.duration - 0.001);
    return trimStart !== baseline.trimStart || trimEnd !== baseline.trimEnd
      || normChk.checked !== baseline.norm || hardCut;
  }
  // Save/Discard are meaningful only with pending changes.
  function updateDirty() {
    const dirty = isDirty();
    saveBtn.disabled = !dirty;
    discardBtn.disabled = !dirty;
  }
  // True if a context switch (play/star/edit/delete/close) should be blocked
  // because changes are pending; shows the prominent warning when it blocks.
  function blockedByPending() {
    if (mode === "review" && isDirty()) { setStatus("Save or discard your changes first.", true); return true; }
    return false;
  }

  // Abandon the current review (a new capture or an in-progress edit) and return
  // to idle — used when the user clicks play/star on a row, navigating away.
  function leaveReview() {
    stopPreview();
    reviewBuffer = null; editId = null; creatingNew = false; hardActive = false;
    clearCanvas(); timer.textContent = "0.00s";
    setMode("idle");
  }

  // Stop a read-only waveform view (play of a take / provided clip) and return
  // to idle. No-op outside viewing.
  function leaveView() {
    if (mode !== "viewing") return;
    stopPreview();
    viewBuffer = null;
    clearCanvas(); timer.textContent = "0.00s";
    setMode("idle");
  }

  async function renderTakes() {
    const { activeId, takes } = await listRecordings(lang, entryKey);
    takesEl.replaceChildren();
    // Placeholder for a brand-new take in progress, so it's clear you're making
    // a NEW one (not the recently edited one). Highlighted as the focus.
    if (creatingNew) {
      const ph = document.createElement("div");
      ph.className = "capture-take is-focused is-placeholder";
      const m = document.createElement("span");
      m.className = "capture-take-meta";
      m.textContent = `Take ${takes.length + 1} · ${mode === "recording" ? "recording…" : "new"}`;
      ph.append(m);
      takesEl.append(ph);
    }
    if (!takes.length && !creatingNew) {
      const em = document.createElement("div");
      em.className = "capture-takes-empty";
      em.textContent = "No recordings yet.";
      takesEl.append(em);
    }
    takes.slice().reverse().forEach((t, i) => {
      const n = takes.length - i;
      const row = document.createElement("div");
      // is-active = the star (plays for the card); is-focused = what you're
      // currently working on / last acted on (the highlighted row).
      row.className = "capture-take" + (t.id === activeId ? " is-active" : "") + (t.id === focusId ? " is-focused" : "");
      const useBtn = document.createElement("button");
      useBtn.type = "button"; useBtn.className = "capture-take-use";
      useBtn.title = t.id === activeId ? "Active (plays for this card)" : "Make active";
      useBtn.textContent = t.id === activeId ? "★" : "☆";
      useBtn.addEventListener("click", async () => {
        if (mode === "recording" || blockedByPending()) return;
        if (mode === "review") leaveReview(); // clicking star leaves the (clean) edit
        leaveView();
        await setActiveRecording(lang, entryKey, t.id);
        focusId = t.id; onChange?.(); renderTakes();
      });
      const play = document.createElement("button");
      play.type = "button"; play.className = "capture-take-play"; play.textContent = "▶";
      play.addEventListener("click", async () => {
        if (mode === "recording" || blockedByPending()) return;
        if (mode === "review") leaveReview(); // clicking play leaves the (clean) edit
        focusId = t.id; renderTakes();
        const blob = await getRecordingBlob(lang, entryKey, t.id);
        viewClip(blob, `Take ${n}`);
      });
      const meta = document.createElement("span");
      meta.className = "capture-take-meta";
      meta.textContent = `Take ${n} · ${(t.durationMs / 1000).toFixed(2)}s · ${fmtAgo(t.createdAt)}`;
      const edit = document.createElement("button");
      edit.type = "button"; edit.className = "capture-take-edit"; edit.title = "Edit / re-trim"; edit.textContent = "✎";
      edit.addEventListener("click", () => { if (mode !== "recording" && !blockedByPending()) loadForEdit(t); });
      const del = document.createElement("button");
      del.type = "button"; del.className = "capture-take-del"; del.title = "Delete"; del.textContent = "🗑";
      del.addEventListener("click", async () => {
        if (mode === "recording" || blockedByPending()) return;
        if (editId === t.id) leaveReview();
        leaveView();
        await deleteRecording(lang, entryKey, t.id);
        if (focusId === t.id) focusId = null;
        onChange?.(); renderTakes();
      });
      row.append(useBtn, play, meta, edit, del);
      takesEl.append(row);
    });

    // Provided clips: the voices we ship for this card (TTS packs / imports).
    // Read-only — you can hear them and see their waveform, but not star, edit,
    // or delete them.
    if (packClipList.length) {
      const groupLabel = document.createElement("div");
      groupLabel.className = "capture-takes-group";
      groupLabel.textContent = "Provided";
      takesEl.append(groupLabel);
      packClipList.forEach(({ voiceId, source, blob, name }) => {
        const packId = `pack::${voiceId}::${source}`;
        const label = (name || voiceId) + (source ? ` · ${source}` : "");
        const row = document.createElement("div");
        row.className = "capture-take is-pack" + (packId === focusId ? " is-focused" : "");
        const play = document.createElement("button");
        play.type = "button"; play.className = "capture-take-play"; play.textContent = "▶";
        play.addEventListener("click", () => {
          if (mode === "recording" || blockedByPending()) return;
          focusId = packId; renderTakes();
          viewClip(blob, label);
        });
        const m = document.createElement("span");
        m.className = "capture-take-meta";
        m.textContent = label;
        row.append(play, m);
        takesEl.append(row);
      });
    }
  }

  // --- recording ---
  async function start() {
    setStatus("");
    stopPreview(); viewBuffer = null; // drop any read-only view in progress
    editId = null;
    creatingNew = true; focusId = null; // a fresh take — show its placeholder
    renderTakes();
    // Mic processing per the toggle. Off → ask the browser to disable auto-gain,
    // noise suppression, and echo cancellation so we capture true levels.
    lastMicProcessing = micChk.checked;
    const audioConstraints = micChk.checked
      ? true
      : { autoGainControl: false, noiseSuppression: false, echoCancellation: false };
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
    } catch (err) {
      setStatus(err && err.name === "NotAllowedError" ? "Microphone permission denied." : `Mic unavailable: ${err?.message || err}`, true);
      creatingNew = false; renderTakes(); // drop the placeholder
      return;
    }
    if (audioCtx.state === "suspended") await audioCtx.resume();
    const srcNode = audioCtx.createMediaStreamSource(stream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    srcNode.connect(analyser);
    chunks = []; liveVals = [];
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    recorder.onstop = onRecordingStopped;
    recorder.start();
    recStartTs = performance.now();
    setMode("recording");
    drawLive();
  }

  function stopTracks() {
    cancelAnimationFrame(rafId);
    if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  }
  function stop() { if (recorder && recorder.state !== "inactive") recorder.stop(); }

  async function onRecordingStopped() {
    stopTracks();
    const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
    try { reviewBuffer = await audioCtx.decodeAudioData(await blob.arrayBuffer()); }
    catch (err) { setStatus(`Could not decode recording: ${err?.message || err}`); creatingNew = false; setMode("idle"); renderTakes(); return; }
    trimStart = 0; trimEnd = reviewBuffer.duration;
    hardActive = false; hardStart = 0; hardEnd = reviewBuffer.duration;
    normChk.checked = false; // fresh-take default
    baseline = { trimStart, trimEnd, norm: false };
    setMode("review");
    renderTakes(); // placeholder text: "recording…" → "new"
    drawReview();
  }

  // --- re-edit an existing take ---
  async function loadForEdit(take) {
    stopPreview();
    setStatus("");
    // The kept original (always present for new takes); fall back to the rendered
    // clip for any legacy take saved without a source.
    const srcBlob = (await getRecordingSource(lang, entryKey, take.id)) || await getRecordingBlob(lang, entryKey, take.id);
    if (!srcBlob) { setStatus("Recording unavailable."); return; }
    const hasSource = take.hasSource !== false;
    if (audioCtx.state === "suspended") await audioCtx.resume();
    try { reviewBuffer = await audioCtx.decodeAudioData(await srcBlob.arrayBuffer()); }
    catch (err) { setStatus(`Could not load: ${err?.message || err}`); return; }
    editId = take.id;
    creatingNew = false;
    focusId = take.id; // highlight the take being edited
    hardActive = false; hardStart = 0; hardEnd = reviewBuffer.duration;
    // Restore the saved soft window + normalize flag from the take.
    trimStart = hasSource && take.trimEnd > take.trimStart ? Math.max(0, take.trimStart) : 0;
    trimEnd = hasSource && take.trimEnd > take.trimStart ? Math.min(take.trimEnd, reviewBuffer.duration) : reviewBuffer.duration;
    normChk.checked = !!take.normalize;
    baseline = { trimStart, trimEnd, norm: !!take.normalize };
    setMode("review");
    setStatus(`Editing ${hasSource ? "take" : "take (legacy)"}`);
    renderTakes();
    drawReview();
  }

  // --- read-only view: play a take / provided clip and show its waveform ---
  // Draws the buffer plain (no trim handles, no controls) with the green
  // playback line. Used for both user takes and the provided pack clips.
  function drawView() {
    if (!viewBuffer) return;
    const n = Math.floor(canvas.width / 3);
    const ps = peaks(viewBuffer, n);
    const dur = viewBuffer.duration;
    const mid = canvas.height / 2;
    canvas.classList.remove("is-hot", "is-clip"); // live flash is recording-only
    clearCanvas(); drawGrid();
    for (let i = 0; i < ps.length; i++) {
      ctx2d.fillStyle = levelColor(ps[i]);
      const h = Math.max(1, ps[i] * canvas.height * 0.92);
      ctx2d.fillRect(i * 3, mid - h / 2, 2, h);
    }
    if (viewProgress != null) {
      const x = viewProgress * canvas.width;
      ctx2d.strokeStyle = GREEN; ctx2d.lineWidth = 2;
      ctx2d.beginPath(); ctx2d.moveTo(x, 0); ctx2d.lineTo(x, canvas.height); ctx2d.stroke();
    }
    const peakPct = Math.round(peakOf(viewBuffer, 0, dur) * 100);
    timer.textContent = `${dur.toFixed(2)}s · peak ${peakPct}%`;
  }

  // Decode `blob`, show its waveform read-only, and play it with the progress
  // line. Falls back to a plain <audio> if decoding fails. Refuses while
  // recording / with pending review changes; leaves a clean review first.
  async function viewClip(blob, labelText) {
    if (mode === "recording" || blockedByPending()) return;
    if (mode === "review") leaveReview();
    stopPreview();
    if (!blob) return;
    if (audioCtx.state === "suspended") await audioCtx.resume();
    let buf;
    try { buf = await audioCtx.decodeAudioData(await blob.arrayBuffer()); }
    catch { new Audio(URL.createObjectURL(blob)).play().catch(() => {}); return; }
    viewBuffer = buf; viewProgress = 0;
    setMode("viewing");
    setStatus(labelText || "");
    drawView();
    previewSrc = audioCtx.createBufferSource();
    previewSrc.buffer = buf;
    previewSrc.connect(audioCtx.destination);
    const startedAt = audioCtx.currentTime;
    const dur = buf.duration;
    previewSrc.onended = () => { previewSrc = null; viewProgress = 1; drawView(); };
    previewSrc.start();
    const tick = () => {
      if (!previewSrc) return;
      viewProgress = Math.min(1, (audioCtx.currentTime - startedAt) / dur);
      drawView();
      if (viewProgress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // --- review: preview (with progress line) + trim drag ---
  function stopPreview() { if (previewSrc) { try { previewSrc.stop(); } catch {} previewSrc = null; } previewProgress = null; viewProgress = null; }
  function preview() {
    stopPreview();
    if (!reviewBuffer) return;
    const dur = Math.max(0.01, trimEnd - trimStart);
    previewSrc = audioCtx.createBufferSource();
    previewSrc.buffer = reviewBuffer;
    // Route through a gain node so the preview is as loud as the saved clip
    // will be (honors the live Normalize toggle).
    const gainNode = audioCtx.createGain();
    gainNode.gain.value = currentGain();
    previewSrc.connect(gainNode); gainNode.connect(audioCtx.destination);
    const startedAt = audioCtx.currentTime;
    previewSrc.onended = () => { previewSrc = null; previewProgress = null; drawReview(); };
    previewSrc.start(0, trimStart, dur);
    const tick = () => {
      if (!previewSrc) return;
      previewProgress = Math.min(1, (audioCtx.currentTime - startedAt) / dur);
      drawReview();
      if (previewProgress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // Keep the soft window inside the hard bounds (a soft bar can't sit outside
  // the hard-trim range, which would drop part of the kept-audio playback).
  function clampSoft() {
    const lo = hardActive ? hardStart : 0;
    const hi = hardActive ? hardEnd : reviewBuffer.duration;
    trimStart = Math.max(lo, Math.min(trimStart, hi - 0.05));
    trimEnd = Math.min(hi, Math.max(trimEnd, trimStart + 0.05));
  }

  function dragHandle(el, which) {
    el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      const rect = canvas.getBoundingClientRect();
      const move = (ev) => {
        const frac = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
        const t = frac * reviewBuffer.duration;
        const lo = hardActive ? hardStart : 0;
        const hi = hardActive ? hardEnd : reviewBuffer.duration;
        if (which === "start") trimStart = Math.max(lo, Math.min(t, trimEnd - 0.05));
        else if (which === "end") trimEnd = Math.min(hi, Math.max(t, trimStart + 0.05));
        else if (which === "hstart") { hardStart = Math.max(0, Math.min(t, hardEnd - 0.05)); clampSoft(); }
        else if (which === "hend") { hardEnd = Math.min(reviewBuffer.duration, Math.max(t, hardStart + 0.05)); clampSoft(); }
        drawReview();
      };
      const up = (ev) => { el.releasePointerCapture(ev.pointerId); el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); };
      el.addEventListener("pointermove", move);
      el.addEventListener("pointerup", up);
    });
  }
  dragHandle(trimStartEl, "start");
  dragHandle(trimEndEl, "end");
  dragHandle(hardStartEl, "hstart");
  dragHandle(hardEndEl, "hend");

  // ✂ Trim file: toggle the red hard-trim bars. On = bars at the full extent
  // (drag them in to cut); off = no hard cut (reset to full).
  function toggleTrim() {
    hardActive = !hardActive;
    if (hardActive) { hardStart = 0; hardEnd = reviewBuffer ? reviewBuffer.duration : 0; }
    trimBtn.classList.toggle("is-on", hardActive);
    hardStartEl.hidden = hardEndEl.hidden = !hardActive;
    setStatus(hardActive ? "Hard-trim: drag the red bars to cut the saved file." : "");
    drawReview();
  }

  async function save() {
    if (!reviewBuffer) return;
    const dur = reviewBuffer.duration;
    // Hard-trim (destructive) bounds: the kept audio. Default = full buffer.
    const hStart = hardActive ? hardStart : 0;
    const hEnd = hardActive ? hardEnd : dur;
    // Stored ORIGINAL = the (hard-cut) buffer, always kept, un-normalized.
    const sourceBlob = encodeWav(reviewBuffer, hStart, hEnd, 1);
    // Rendered playback clip = soft window, normalized if flagged. Card playback
    // plays a plain blob, so the soft trim + normalize are baked into this clip;
    // the original above + the flags below let re-edit reconstruct it.
    const clip = encodeWav(reviewBuffer, trimStart, trimEnd, currentGain());
    const durMs = (trimEnd - trimStart) * 1000;
    const opts2 = {
      sourceBlob,
      trimStart: trimStart - hStart,         // soft bounds relative to the kept original
      trimEnd: trimEnd - hStart,
      normalize: normChk.checked,
      fullDurationMs: (hEnd - hStart) * 1000
    };
    let savedId;
    if (editId) { await updateRecording(lang, entryKey, editId, clip, durMs, opts2); savedId = editId; }
    else { savedId = await addRecording(lang, entryKey, clip, durMs, opts2); }
    editId = null; creatingNew = false; hardActive = false; focusId = savedId;
    stopPreview(); reviewBuffer = null; clearCanvas(); timer.textContent = "0.00s";
    setMode("idle");
    setStatus("Saved.");
    onChange?.();
    renderTakes();
  }

  function discard() {
    // Keep an edited take highlighted; a discarded new take has no focus.
    focusId = editId || null;
    editId = null; creatingNew = false; hardActive = false;
    stopPreview(); reviewBuffer = null; clearCanvas(); timer.textContent = "0.00s";
    setMode("idle");
    setStatus("");
    renderTakes();
  }

  function close() {
    stopTracks(); stopPreview();
    try { audioCtx.close(); } catch {}
    document.removeEventListener("keydown", onKey, true);
    backdrop.remove();
  }
  // ✕ / backdrop: can't close with pending changes (Save or Discard first).
  function requestClose() {
    if (mode === "recording" || blockedByPending()) return;
    close();
  }
  // Esc = discard the current edit (handles pending changes); from idle it
  // closes the widget.
  function onKey(e) {
    if (e.key !== "Escape" || mode === "recording") return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (mode === "review") discard();
    else close();
  }

  startBtn.addEventListener("click", start);
  stopBtn.addEventListener("click", stop);
  normChk.addEventListener("change", () => drawReview()); // live: rescale waveform + peak readout (+ dirty)
  trimBtn.addEventListener("click", toggleTrim);
  playBtn.addEventListener("click", preview);
  saveBtn.addEventListener("click", save);
  discardBtn.addEventListener("click", discard);
  closeBtn.addEventListener("click", requestClose);
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) requestClose(); });
  document.addEventListener("keydown", onKey, true);

  setMode("idle");
  renderTakes();
  // Provided clips are precomputed + warmed by the card page (no IDB scan here),
  // so this resolves instantly; re-render once they're in to show the rows.
  if (typeof getPackClips === "function") {
    Promise.resolve(getPackClips()).then((list) => { packClipList = list || []; renderTakes(); }).catch(() => {});
  }
}
