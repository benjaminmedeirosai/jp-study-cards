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
//     --zip         also write audio/<lang>-<slug>.zip of the generated subtree.
//
// Only needed when words are added/changed — regenerate just that folder.

import { execFileSync } from "node:child_process";
import { mkdirSync, existsSync, rmSync, readFileSync } from "node:fs";
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
const voiceCache = new Map();
function voiceForLang(ttsLang) {
  const locale = String(ttsLang || "").replace("-", "_"); // fa-IR → fa_IR
  if (voiceCache.has(locale)) return voiceCache.get(locale);
  const listing = execFileSync("say", ["-v", "?"], { encoding: "utf8" });
  // Lines look like: "Dariush (Enhanced)  fa_IR    # Hello!..."
  let match = "";
  for (const line of listing.split("\n")) {
    const m = line.match(/^(.+?)\s{2,}([A-Za-z_]+)\s/);
    if (m && m[2] === locale) { match = m[1].trim(); break; }
  }
  if (!match) throw new Error(`no installed voice for locale ${locale} — install one in System Settings › Accessibility › Spoken Content`);
  voiceCache.set(locale, match);
  return match;
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
const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const [lang, deckPrefix] = args.filter((a) => !a.startsWith("--"));
const FORCE = flags.has("--force");
const WANT_ZIP = flags.has("--zip");
if (!lang) {
  console.error("usage: node tools/audio/gen-audio.mjs <lang> [deckPrefix] [--force] [--zip]");
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

let made = 0, skipped = 0, failed = 0;
for (const deck of decks) {
  const lib = libFor(deck);
  if (!lib) { console.warn(`! no library for deck ${deck.id} (kind ${deck.kind}) — skipping`); continue; }
  const voice = voiceForLang(lib.tts && lib.tts.lang);
  const outDir = path.join(ROOT, "audio", lang, deck.id);
  mkdirSync(outDir, { recursive: true });
  for (const entry of deck.entries) {
    const slug = audioSlug(entry, lib);
    const text = audioText(entry, lib);
    if (!slug || !text) { console.warn(`! ${deck.id}: empty slug/text for`, entry); failed++; continue; }
    const out = path.join(outDir, `${slug}.m4a`);
    if (!FORCE && existsSync(out)) { skipped++; continue; }
    try {
      synth(voice, text, out);
      made++;
      process.stdout.write(`\r${deck.id}/${slug}  "${text}"            `);
    } catch (err) {
      console.error(`\n! failed ${deck.id}/${slug}: ${err.message}`);
      failed++;
    }
  }
}
process.stdout.write("\n");
console.log(`[audio] ${lang}${deckPrefix ? "/" + deckPrefix : ""}: ${made} generated, ${skipped} skipped, ${failed} failed`);

if (WANT_ZIP) {
  // Publish the FULL language pack (every clip under audio/<lang>/, regardless
  // of which folder this run regenerated) to public/audio/<lang>.zip — the
  // committed artifact the app fetches. Paths inside read as
  // <lang>/<deckId>/<slug>.m4a, exactly what the importer expects.
  const publicDir = path.join(ROOT, "public", "audio");
  mkdirSync(publicDir, { recursive: true });
  const zipPath = path.join(publicDir, `${lang}.zip`);
  if (existsSync(zipPath)) rmSync(zipPath);
  execFileSync("zip", ["-r", "-q", zipPath, lang], { cwd: path.join(ROOT, "audio") });
  console.log(`[audio] published ${path.relative(ROOT, zipPath)}`);
}
