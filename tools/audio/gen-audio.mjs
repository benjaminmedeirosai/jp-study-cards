#!/usr/bin/env node
// Offline-audio generator (macOS only — uses `say` + `afconvert`).
//
// Synthesizes a TTS clip per card and writes the 1-1 mirror of data/:
//   data/<lang>/<deckId>.tsv  →  audio/<lang>/<deckId>/<slug>.m4a
// The filename slug and spoken text come from src/audio/audioKey.js, the SAME
// module the app uses on import — so the two never disagree.
//
// Usage:
//   node tools/audio/gen-audio.mjs <lang> [deckPrefix] [--force] [--zip]
//     <lang>        e.g. farsi  (reads data/<lang>/cards.json)
//     [deckPrefix]  only decks whose id starts with this (folder scope),
//                   e.g. "alphabet" or "words/numbers". Omit for all decks.
//     --force       re-synthesize even if the .m4a already exists.
//     --zip         (re)publish public/audio/<lang>.zip + update the manifest.
//
// Only needed when words are added/changed — regenerate just that folder.

import { execFileSync } from "node:child_process";
import { mkdirSync, existsSync, rmSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import os from "node:os";

import { LIBRARIES } from "../../src/core/libraries.js";
import { audioSlug, audioText, audioTextForSource, audioMultiSource } from "../../src/audio/audioKey.js";

const ROOT = path.resolve(import.meta.dirname, "..", "..");

// --- synthesis (mirrors the project's say/afconvert settings) --------------
const SAY_FILE_FORMAT = "WAVE";
const SAY_DATA_FORMAT = "LEI16@22050";
const AAC_BITRATE = "64000";

// Resolve the installed voice whose locale matches the library's tts lang
// (e.g. fa-IR → the fa_IR voice). Cached per locale.
// A short, path-safe id for a voice (the dir/key segment): drop the
// "(Enhanced)"-style qualifier, then slugify. "Carlos (Enhanced)" → "carlos".
function voiceIdOf(name) {
  return name.replace(/\([^)]*\)/g, "").trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9_-]/g, "");
}

let sayListing = null;
function installedVoices() {
  if (!sayListing) sayListing = execFileSync("say", ["-v", "?"], { encoding: "utf8" });
  return sayListing;
}
// Auto-resolve the installed voice for a tts locale (fa-IR → the fa_IR voice).
// When several voices share a locale (e.g. "Melina" + "Melina (Enhanced)"),
// prefer the higher-quality Premium/Enhanced variant.
function voiceForLang(ttsLang) {
  const locale = String(ttsLang || "").replace("-", "_");
  const matches = [];
  for (const line of installedVoices().split("\n")) {
    const m = line.match(/^(.+?)\s{2,}([A-Za-z_]+)\s/);
    if (m && m[2] === locale) matches.push(m[1].trim());
  }
  if (!matches.length) throw new Error(`no installed voice for locale ${locale} — install one in System Settings › Accessibility › Spoken Content`);
  return matches.find((n) => /\((?:Premium|Enhanced)\)/i.test(n)) || matches[0];
}
function assertVoiceInstalled(name) {
  const ok = installedVoices().split("\n").some((line) => line.startsWith(name + " ") || line.startsWith(name + "\t") || line.trimEnd().startsWith(name + " "));
  if (!ok) throw new Error(`voice "${name}" is not installed (see \`say -v '?'\`)`);
}
// The voice's locale, e.g. "Carlos (Enhanced)" → "es-CO" (say lists "es_CO").
function localeOfVoice(name) {
  for (const line of installedVoices().split("\n")) {
    const m = line.match(/^(.+?)\s{2,}([A-Za-z_]+)\s/);
    if (m && m[1].trim() === name) return m[2].replace("_", "-");
  }
  return "";
}

// Synthesis is split so per-source dedup can compare at the PCM/WAV stage:
// `say` output is byte-deterministic for identical text, but the AAC .m4a
// container embeds creation/modification timestamps (mvhd atom), so two m4a
// files of the SAME audio made seconds apart differ. Comparing WAVs avoids that.
function sayToWav(voice, text) {
  const tmp = path.join(os.tmpdir(), `tts-${process.pid}-${Math.random().toString(36).slice(2)}.wav`);
  execFileSync("say", ["-v", voice, "--file-format", SAY_FILE_FORMAT, "--data-format", SAY_DATA_FORMAT, "-o", tmp, text]);
  return tmp;
}
function wavToM4a(wav, outPath) {
  execFileSync("afconvert", ["-f", "m4af", "-d", "aac", "-b", AAC_BITRATE, wav, outPath]);
}
function synth(voice, text, outPath) {
  const wav = sayToWav(voice, text);
  try { wavToM4a(wav, outPath); } finally { if (existsSync(wav)) rmSync(wav); }
}

// --- args ------------------------------------------------------------------
const argv = process.argv.slice(2);
const flags = new Set();
const positionals = [];
let VOICE_NAME = "";
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--voice") VOICE_NAME = argv[++i] || "";
  else if (argv[i].startsWith("--")) flags.add(argv[i]);
  else positionals.push(argv[i]);
}
const [lang, deckPrefix] = positionals;
const FORCE = flags.has("--force");
const WANT_ZIP = flags.has("--zip");
if (!lang) {
  console.error('usage: node tools/audio/gen-audio.mjs <lang> [deckPrefix] [--voice "Name"] [--force] [--zip]');
  process.exit(1);
}

const bundlePath = path.join(ROOT, "data", lang, "cards.json");
if (!existsSync(bundlePath)) {
  console.error(`missing bundle: ${bundlePath} — run the data bundler first`);
  process.exit(1);
}
const bundle = JSON.parse(readFileSync(bundlePath, "utf8"));

// Pick the library config for a deck by language + deck kind (alpha/word/...).
function libFor(deck) {
  const kind = deck.kind || "word";
  return LIBRARIES.find((l) => l.language === lang && l.deckKind === kind);
}

const decks = bundle.decks.filter((d) => !deckPrefix || d.id === deckPrefix || d.id.startsWith(deckPrefix + "/") || d.id.startsWith(deckPrefix));
if (!decks.length) {
  console.error(`no decks in ${lang} matching "${deckPrefix || "(all)"}"`);
  process.exit(1);
}

// Resolve the voice once for the whole run: explicit --voice, else auto from
// the language's tts locale. Clips for a voice live under audio/<lang>/<voiceId>/
// so a word can have multiple voices side by side.
let voiceName = VOICE_NAME;
if (voiceName) {
  assertVoiceInstalled(voiceName);
} else {
  const anyLib = LIBRARIES.find((l) => l.language === lang);
  voiceName = voiceForLang(anyLib && anyLib.tts ? anyLib.tts.lang : "");
}
const vid = voiceIdOf(voiceName);
console.log(`[audio] voice: ${voiceName} (id ${vid})`);

// Remember each voice's display name (keyed <lang>/<vid>) outside the zipped
// tree, so a later --zip run can recover names for voices generated separately.
const namesPath = path.join(ROOT, "audio", ".voice-names.json");
let voiceNames = {};
if (existsSync(namesPath)) { try { voiceNames = JSON.parse(readFileSync(namesPath, "utf8")); } catch {} }
voiceNames[`${lang}/${vid}`] = { name: voiceName, locale: localeOfVoice(voiceName) };
mkdirSync(path.join(ROOT, "audio"), { recursive: true });
writeFileSync(namesPath, JSON.stringify(voiceNames, null, 2) + "\n");

// Byte-equal? Used to drop a redundant per-source clip.
function filesEqual(a, b) {
  if (!existsSync(a) || !existsSync(b)) return false;
  const ba = readFileSync(a), bb = readFileSync(b);
  return ba.length === bb.length && ba.equals(bb);
}

// Recursively count .m4a files (and total bytes) under a directory.
function countM4a(dir) {
  let n = 0;
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) n += countM4a(full);
    else if (name.endsWith(".m4a")) n += 1;
  }
  return n;
}
function bytesM4a(dir) {
  let n = 0;
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) n += bytesM4a(full);
    else if (name.endsWith(".m4a")) n += st.size;
  }
  return n;
}

// Scan audio/<lang>/ for the voices present → { <voiceId>: { name, locale,
// clips } }. Names/locales come from .voice-names.json (recorded each run),
// falling back to a prior manifest's values, then the bare id. Used both for
// the published manifest (--zip) and the per-pack "<lang>/voices.json" that
// makes unpublished imports show real voice names.
function scanVoices(langDir, prevVoices = {}) {
  const voices = {};
  for (const voiceDir of readdirSync(langDir)) {
    if (!statSync(path.join(langDir, voiceDir)).isDirectory()) continue;
    const fromNames = voiceNames[`${lang}/${voiceDir}`];
    const prev = prevVoices[voiceDir] || {};
    const name = (fromNames && fromNames.name) || prev.name || voiceDir;
    const locale = (fromNames && fromNames.locale) || prev.locale || "";
    const vDir = path.join(langDir, voiceDir);
    voices[voiceDir] = { name, locale, clips: countM4a(vDir), bytes: bytesM4a(vDir) };
  }
  return voices;
}

let made = 0, skipped = 0, failed = 0, deduped = 0;
for (const deck of decks) {
  const lib = libFor(deck);
  if (!lib) { console.warn(`! no library for deck ${deck.id} (kind ${deck.kind}) — skipping`); continue; }
  const outDir = path.join(ROOT, "audio", lang, vid, deck.id);
  mkdirSync(outDir, { recursive: true });
  const multi = audioMultiSource(lib);
  // Synthesize one clip; return true on success. Skips an up-to-date file.
  const make = (text, stem) => {
    const out = path.join(outDir, `${stem}.m4a`);
    if (!FORCE && existsSync(out)) { skipped++; return; }
    try {
      synth(voiceName, text, out);
      made++;
      process.stdout.write(`\r${vid}/${deck.id}/${stem}  "${text}"            `);
    } catch (err) {
      console.error(`\n! failed ${deck.id}/${stem}: ${err.message}`);
      failed++;
    }
  };
  for (const entry of deck.entries) {
    const slug = audioSlug(entry, lib);
    if (!slug) { console.warn(`! ${deck.id}: empty slug for`, entry); failed++; continue; }
    if (!multi) { // single-source libs: one "<slug>.m4a" (unchanged)
      const text = audioText(entry, lib);
      if (!text) { console.warn(`! ${deck.id}: empty text for`, entry); failed++; continue; }
      make(text, slug);
      continue;
    }
    // Multi-source (Japanese words: kanji + hiragana). The first source is the
    // primary, always written "<slug>.<source>.m4a". Each later source is KEPT
    // only if its audio differs from the primary's — a word read identically
    // (most read correctly via kanji) needs no second clip; playback falls back
    // to the primary. Dedup compares WAVs (see sayToWav) so identical audio is
    // caught despite m4a timestamps.
    const srcVals = lib.soundSources.map((s) => s.value);
    const primary = srcVals[0];
    const primaryText = audioTextForSource(entry, lib, primary);
    if (!primaryText) { console.warn(`! ${deck.id}: empty text [${primary}] for`, entry); failed++; continue; }
    let primaryWav;
    try {
      primaryWav = sayToWav(voiceName, primaryText);
      const primaryOut = path.join(outDir, `${slug}.${primary}.m4a`);
      if (FORCE || !existsSync(primaryOut)) {
        wavToM4a(primaryWav, primaryOut); made++;
        process.stdout.write(`\r${vid}/${deck.id}/${slug}.${primary}  "${primaryText}"            `);
      } else skipped++;
      for (const src of srcVals.slice(1)) {
        const text = audioTextForSource(entry, lib, src);
        if (!text) { console.warn(`! ${deck.id}: empty text [${src}] for`, entry); failed++; continue; }
        const out = path.join(outDir, `${slug}.${src}.m4a`);
        if (!FORCE && existsSync(out)) { skipped++; continue; }
        const srcWav = sayToWav(voiceName, text);
        try {
          if (filesEqual(srcWav, primaryWav)) { if (existsSync(out)) rmSync(out); deduped++; }
          else { wavToM4a(srcWav, out); made++; process.stdout.write(`\r${vid}/${deck.id}/${slug}.${src}  "${text}"            `); }
        } finally { if (existsSync(srcWav)) rmSync(srcWav); }
      }
    } catch (err) {
      console.error(`\n! failed ${deck.id}/${slug}: ${err.message}`);
      failed++;
    } finally { if (primaryWav && existsSync(primaryWav)) rmSync(primaryWav); }
  }
}
process.stdout.write("\n");
console.log(`[audio] ${lang}${deckPrefix ? "/" + deckPrefix : ""}: ${made} generated, ${deduped} deduped, ${skipped} skipped, ${failed} failed`);

// Always (re)write audio/<lang>/voices.json so any zip of the folder — even a
// manual, unpublished one (Japanese) — carries voice names/locales/sizes AND a
// content version for the app: it shows them after import, and the version lets
// a re-import of the same pack be skipped (while a real change still re-imports).
{
  const langDir = path.join(ROOT, "audio", lang);
  if (existsSync(langDir)) {
    const voices = scanVoices(langDir);
    const version = createHash("sha256").update(JSON.stringify(voices)).digest("hex").slice(0, 12);
    writeFileSync(path.join(langDir, "voices.json"), JSON.stringify({ version, voices }, null, 2) + "\n");
  }
}

if (WANT_ZIP) {
  // Publish the FULL language pack (every clip under audio/<lang>/, all voices,
  // regardless of which folder/voice this run regenerated) to
  // public/audio/<lang>.zip — the committed artifact the app fetches. Paths
  // inside read as <lang>/<voiceId>/<deckId>/<slug>.m4a.
  const publicDir = path.join(ROOT, "public", "audio");
  mkdirSync(publicDir, { recursive: true });
  const zipPath = path.join(publicDir, `${lang}.zip`);
  if (existsSync(zipPath)) rmSync(zipPath);
  execFileSync("zip", ["-r", "-q", zipPath, lang], { cwd: path.join(ROOT, "audio") });
  console.log(`[audio] published ${path.relative(ROOT, zipPath)}`);

  // Update the manifest. version = content hash of the zip (changes whenever any
  // voice/clip changes → drives the app's "update available"). voices lists each
  // voice dir present in the pack with its display name + clip count. Names for
  // voices generated in earlier runs are carried over from the prior manifest.
  const manifestPath = path.join(publicDir, "manifest.json");
  let manifest = {};
  if (existsSync(manifestPath)) { try { manifest = JSON.parse(readFileSync(manifestPath, "utf8")); } catch {} }
  const prevVoices = (manifest[lang] && manifest[lang].voices) || {};
  const langDir = path.join(ROOT, "audio", lang);
  const voices = scanVoices(langDir, prevVoices);
  const version = createHash("sha256").update(readFileSync(zipPath)).digest("hex").slice(0, 12);
  manifest[lang] = { version, voices };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  const voiceSummary = Object.entries(voices).map(([id, v]) => `${id} ${v.clips}`).join(", ");
  console.log(`[audio] manifest ${lang} → ${version} (voices: ${voiceSummary})`);
}
