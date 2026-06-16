#!/usr/bin/env node
// Offline-audio generator (macOS only — uses `say` + `afconvert`).
//
// Synthesizes a TTS clip per card and writes the 1-1 mirror of data/:
//   data/<lang>/<deckId>.tsv  →  audio/<lang>/<deckId>/<slug>.m4a
// The filename slug and spoken text come from src/study/audioKey.js, the SAME
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

import { LIBRARIES } from "../../src/study/libraries.js";
import { audioSlug, audioText } from "../../src/study/audioKey.js";

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
function voiceForLang(ttsLang) {
  const locale = String(ttsLang || "").replace("-", "_");
  for (const line of installedVoices().split("\n")) {
    const m = line.match(/^(.+?)\s{2,}([A-Za-z_]+)\s/);
    if (m && m[2] === locale) return m[1].trim();
  }
  throw new Error(`no installed voice for locale ${locale} — install one in System Settings › Accessibility › Spoken Content`);
}
function assertVoiceInstalled(name) {
  const ok = installedVoices().split("\n").some((line) => line.startsWith(name + " ") || line.startsWith(name + "\t") || line.trimEnd().startsWith(name + " "));
  if (!ok) throw new Error(`voice "${name}" is not installed (see \`say -v '?'\`)`);
}

function synth(voice, text, outPath) {
  const tmp = path.join(os.tmpdir(), `tts-${process.pid}-${Math.random().toString(36).slice(2)}.wav`);
  try {
    execFileSync("say", ["-v", voice, "--file-format", SAY_FILE_FORMAT, "--data-format", SAY_DATA_FORMAT, "-o", tmp, text]);
    execFileSync("afconvert", ["-f", "m4af", "-d", "aac", "-b", AAC_BITRATE, tmp, outPath]);
  } finally {
    if (existsSync(tmp)) rmSync(tmp);
  }
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
voiceNames[`${lang}/${vid}`] = voiceName;
mkdirSync(path.join(ROOT, "audio"), { recursive: true });
writeFileSync(namesPath, JSON.stringify(voiceNames, null, 2) + "\n");

let made = 0, skipped = 0, failed = 0;
for (const deck of decks) {
  const lib = libFor(deck);
  if (!lib) { console.warn(`! no library for deck ${deck.id} (kind ${deck.kind}) — skipping`); continue; }
  const outDir = path.join(ROOT, "audio", lang, vid, deck.id);
  mkdirSync(outDir, { recursive: true });
  for (const entry of deck.entries) {
    const slug = audioSlug(entry, lib);
    const text = audioText(entry, lib);
    if (!slug || !text) { console.warn(`! ${deck.id}: empty slug/text for`, entry); failed++; continue; }
    const out = path.join(outDir, `${slug}.m4a`);
    if (!FORCE && existsSync(out)) { skipped++; continue; }
    try {
      synth(voiceName, text, out);
      made++;
      process.stdout.write(`\r${vid}/${deck.id}/${slug}  "${text}"            `);
    } catch (err) {
      console.error(`\n! failed ${deck.id}/${slug}: ${err.message}`);
      failed++;
    }
  }
}
process.stdout.write("\n");
console.log(`[audio] ${lang}${deckPrefix ? "/" + deckPrefix : ""}: ${made} generated, ${skipped} skipped, ${failed} failed`);

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
  const countM4a = (dir) => {
    let n = 0;
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) n += countM4a(full);
      else if (name.endsWith(".m4a")) n += 1;
    }
    return n;
  };
  const manifestPath = path.join(publicDir, "manifest.json");
  let manifest = {};
  if (existsSync(manifestPath)) { try { manifest = JSON.parse(readFileSync(manifestPath, "utf8")); } catch {} }
  const prevVoices = (manifest[lang] && manifest[lang].voices) || {};
  const langDir = path.join(ROOT, "audio", lang);
  const voices = {};
  for (const voiceDir of readdirSync(langDir)) {
    if (!statSync(path.join(langDir, voiceDir)).isDirectory()) continue;
    const name = voiceNames[`${lang}/${voiceDir}`] || (prevVoices[voiceDir] && prevVoices[voiceDir].name) || voiceDir;
    voices[voiceDir] = { name, clips: countM4a(path.join(langDir, voiceDir)) };
  }
  const version = createHash("sha256").update(readFileSync(zipPath)).digest("hex").slice(0, 12);
  manifest[lang] = { version, voices };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  const voiceSummary = Object.entries(voices).map(([id, v]) => `${id} ${v.clips}`).join(", ");
  console.log(`[audio] manifest ${lang} → ${version} (voices: ${voiceSummary})`);
}
