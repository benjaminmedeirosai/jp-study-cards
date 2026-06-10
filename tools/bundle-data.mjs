// Bundle the per-deck data files into a single data/cards.json that the app
// fetches once at startup (instead of one request per deck).
//
// data/ IS the source of truth — there is no manifest. This script walks the
// tree, and for each .tsv deck derives everything from its location and name:
//
//   data/words/adjectives/na-adjectives/qualities.tsv
//        └────────────── category ─────────────┘ └ label
//
//   • id       = path under data/ minus extension  (words/adjectives/na-adjectives/qualities)
//   • category = ancestor folders, title-cased, joined " / "  ("Words / Adjectives / Na Adjectives")
//   • label    = title-cased filename ("Qualities"), unless the deck overrides
//                it with a `# label: ...` line in its header (used for labels a
//                filename can't carry, e.g. "〜本 (long objects)", "Meat & Seafood").
//   • count    = number of entries, derived from the rows.
//
// Add a deck by dropping a .tsv in the right folder; rename/move to recategorize.
// Nothing else to update. Then run: node tools/bundle-data.mjs
//
// Reading texts live under data/texts/<slug>/ and are emitted to a separate
// `texts` array (see "Reading texts" below): blob.txt is the reference
// paragraph, sentences.tsv splits it into sentences, and words.tsv is an
// ordinary studyable deck (it still appears in `decks`).
//
// data/cards.json is generated — never hand-edit it.

import fs from "node:fs/promises";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const dataRoot = path.join(repoRoot, "data");
const REQUIRED_HEADERS = ["kanji", "hiragana", "type", "english"];
const SENTENCE_HEADERS = ["japanese", "reading", "english"];

// "na-adjectives" -> "Na Adjectives"; "food" -> "Food"
function titleCase(segment) {
  return segment
    .split("-")
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(" ");
}

// Parse a .tsv deck. Skips blank lines and `#` comment lines, but reads a
// `# label: ...` directive out of the header as a display-name override.
function parseTsv(source, file) {
  let label = null;
  const lines = [];
  for (const rawLine of source.replace(/\r\n?/g, "\n").split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("#")) {
      const m = line.match(/^#\s*label:\s*(.+?)\s*$/i);
      if (m) label = m[1];
      continue;
    }
    lines.push(rawLine);
  }
  if (!lines.length) return { label, entries: [] };
  const headers = lines[0].split("\t").map((header) => header.trim());
  if (!REQUIRED_HEADERS.every((header, index) => headers[index] === header)) {
    throw new Error(`${file}: expected TSV header ${REQUIRED_HEADERS.join("\\t")}`);
  }
  const hasBreakdown = headers[REQUIRED_HEADERS.length] === "breakdown";
  const entries = lines.slice(1).map((line) => {
    const fields = line.split("\t");
    const entry = Object.fromEntries(REQUIRED_HEADERS.map((header, index) => [header, (fields[index] || "").trim()]));
    // Optional 5th column: per-kanji gloss "[漢: contribution | 漢: …]".
    // Only carried through when present and non-empty, so cards.json stays lean.
    if (hasBreakdown) {
      const breakdown = (fields[REQUIRED_HEADERS.length] || "").trim();
      if (breakdown) entry.breakdown = breakdown;
    }
    return entry;
  });
  return { label, entries };
}

// Parse a texts/<slug>/sentences.tsv: same comment/`# label:` rules as a deck,
// but a `japanese / reading / english` header — one row per sentence.
function parseSentences(source, file) {
  let label = null;
  const lines = [];
  for (const rawLine of source.replace(/\r\n?/g, "\n").split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("#")) {
      const m = line.match(/^#\s*label:\s*(.+?)\s*$/i);
      if (m) label = m[1];
      continue;
    }
    lines.push(rawLine);
  }
  if (!lines.length) return { label, sentences: [] };
  const headers = lines[0].split("\t").map((header) => header.trim());
  if (!SENTENCE_HEADERS.every((header, index) => headers[index] === header)) {
    throw new Error(`${file}: expected TSV header ${SENTENCE_HEADERS.join("\\t")}`);
  }
  const sentences = lines.slice(1).map((line) => {
    const fields = line.split("\t");
    return Object.fromEntries(SENTENCE_HEADERS.map((header, index) => [header, (fields[index] || "").trim()]));
  });
  return { label, sentences };
}

// Recursively collect every .tsv (deck/sentence data) and .txt (blob) under data/.
async function walk(dir) {
  const out = [];
  for (const dirent of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, dirent.name);
    if (dirent.isDirectory()) out.push(...await walk(full));
    else if (dirent.isFile() && (dirent.name.endsWith(".tsv") || dirent.name.endsWith(".txt"))) out.push(full);
  }
  return out;
}

// A file under data/texts/ is "reading-text aux" (folded into a `texts` entry,
// not emitted as a deck) when it's the blob or the sentence split. words.tsv is
// NOT aux — it falls through to the normal deck path so it stays studyable.
function textAuxKind(rel) {
  if (!rel.startsWith("texts/")) return null;
  const base = rel.split("/").pop();
  if (base === "blob.txt") return "blob";
  if (base === "sentences.tsv") return "sentences";
  return null;
}

const files = (await walk(dataRoot)).sort();
const decks = [];
const textSets = new Map(); // "texts/<slug>" -> { blob, sentences, label, wordsDeckId }
const textSet = (id) => {
  if (!textSets.has(id)) textSets.set(id, { blob: "", sentences: [], label: null, wordsDeckId: null });
  return textSets.get(id);
};

for (const file of files) {
  const rel = path.relative(dataRoot, file).replace(/\\/g, "/");
  const aux = textAuxKind(rel);
  if (aux) {
    const setId = rel.split("/").slice(0, 2).join("/"); // "texts/<slug>"
    const source = await fs.readFile(file, "utf8");
    if (aux === "blob") textSet(setId).blob = source.trim();
    else {
      const { label, sentences } = parseSentences(source, rel);
      const set = textSet(setId);
      set.sentences = sentences;
      if (label) set.label = label;
    }
    continue;
  }
  if (!rel.endsWith(".tsv")) continue; // stray .txt outside a texts set — ignore
  const id = rel.replace(/\.tsv$/, "");
  const segments = id.split("/");
  const fileSeg = segments.pop();
  const { label: labelOverride, entries } = parseTsv(await fs.readFile(file, "utf8"), rel);
  decks.push({
    id,
    label: labelOverride || titleCase(fileSeg),
    category: segments.map(titleCase).join(" / "),
    count: entries.length,
    entries
  });
  // A texts/<slug>/words.tsv deck is also the text set's vocab list.
  if (rel.startsWith("texts/") && fileSeg === "words") {
    textSet(segments.join("/")).wordsDeckId = id;
  }
}

// Assemble the `texts` array: one entry per data/texts/<slug>/ folder.
const texts = [...textSets.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([id, set]) => ({
  id,
  label: set.label || titleCase(id.split("/").pop()),
  category: titleCase(id.split("/")[0]), // "Texts"
  blob: set.blob,
  sentences: set.sentences,
  wordsDeckId: set.wordsDeckId
}));

const bundle = {
  version: "data",
  generatedAt: new Date().toISOString(),
  decks,
  texts
};

await fs.writeFile(path.join(dataRoot, "cards.json"), JSON.stringify(bundle));
const total = decks.reduce((sum, deck) => sum + deck.count, 0);
const sentenceCount = texts.reduce((sum, t) => sum + t.sentences.length, 0);
console.log(`Bundled ${decks.length} decks · ${total} entries · ${texts.length} texts (${sentenceCount} sentences) → data/cards.json`);
