// Audit the study-card data and write two dev-reference reports to ./tmp/.
// These are throwaway local artifacts — tmp/ is gitignored, so they're never
// committed and the app never consumes them.
//
//  1. tmp/kanji-coverage-1.json / tmp/kanji-coverage-2.json — kanji characters
//     that appear in exactly ONE / exactly TWO distinct words, split so it's easy
//     to see how many have 1 vs 2. Shape: [{ kanji, wordCount, words: [...] }].
//
//  2. tmp/duplicates.json — words (kanji+reading) that occur more than once,
//     whether across files or within one file. Dups are fine; this is just
//     visibility. Shape: [{ word, kanji, hiragana, count, occurrences: [...] }].
//
// Usage: node tools/audit-data.mjs

import fs from "node:fs/promises";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const dataRoot = path.join(repoRoot, "data");
const REQUIRED_HEADERS = ["kanji", "hiragana", "type", "english"];
const OUT_DIR = path.join(repoRoot, "tmp");

// Same TSV parsing as bundle-data.mjs: skip blanks and `#` comment lines.
function parseTsv(source, file) {
  const lines = source
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((line) => line.trim() && !line.trimStart().startsWith("#"));
  if (!lines.length) return [];
  const headers = lines[0].split("\t").map((header) => header.trim());
  if (!REQUIRED_HEADERS.every((header, index) => headers[index] === header)) {
    throw new Error(`${file}: expected TSV header ${REQUIRED_HEADERS.join("\\t")}`);
  }
  return lines.slice(1).map((line) => {
    const fields = line.split("\t");
    return Object.fromEntries(REQUIRED_HEADERS.map((header, index) => [header, (fields[index] || "").trim()]));
  });
}

const isHan = (ch) => /\p{Script=Han}/u.test(ch);
const hanChars = (str) => [...str].filter(isHan);

// --- Load every entry referenced by index.json, tagged with its source file ---
const index = JSON.parse(await fs.readFile(path.join(dataRoot, "index.json"), "utf8"));
const entries = [];
for (const deck of index.decks || []) {
  const rel = String(deck.path).replace(/^\/data\//, "");
  const raw = await fs.readFile(path.join(dataRoot, rel), "utf8");
  const rows = rel.endsWith(".tsv") ? parseTsv(raw, rel) : JSON.parse(raw);
  for (const row of rows) {
    entries.push({ ...row, file: rel, deckId: deck.id });
  }
}

// --- Report 1: under-covered kanji (appears in < 3 distinct words) ---
const kanjiToWords = new Map(); // kanji char -> Set of distinct kanji-form words
for (const e of entries) {
  for (const ch of new Set(hanChars(e.kanji))) {
    if (!kanjiToWords.has(ch)) kanjiToWords.set(ch, new Set());
    kanjiToWords.get(ch).add(e.kanji);
  }
}
const coverage = [...kanjiToWords.entries()]
  .map(([kanji, words]) => ({ kanji, wordCount: words.size, words: [...words].sort() }))
  .sort((a, b) => a.kanji.codePointAt(0) - b.kanji.codePointAt(0));
const coverage1 = coverage.filter((row) => row.wordCount === 1);
const coverage2 = coverage.filter((row) => row.wordCount === 2);

// --- Report 2: duplicate words (same kanji+reading in 2+ places) ---
const byForm = new Map(); // "kanji\thiragana" -> occurrences[]
for (const e of entries) {
  const key = `${e.kanji}\t${e.hiragana}`;
  if (!byForm.has(key)) byForm.set(key, []);
  byForm.get(key).push({ file: e.file, deckId: e.deckId, type: e.type, english: e.english });
}
const duplicates = [...byForm.entries()]
  .filter(([, occ]) => occ.length > 1)
  .map(([key, occ]) => {
    const [kanji, hiragana] = key.split("\t");
    return { word: kanji === hiragana ? kanji : `${kanji}（${hiragana}）`, kanji, hiragana, count: occ.length, occurrences: occ };
  })
  .sort((a, b) => b.count - a.count || a.kanji.localeCompare(b.kanji, "ja"));

await fs.mkdir(OUT_DIR, { recursive: true });
const cov1Path = path.join(OUT_DIR, "kanji-coverage-1.json");
const cov2Path = path.join(OUT_DIR, "kanji-coverage-2.json");
const dupPath = path.join(OUT_DIR, "duplicates.json");
await fs.writeFile(cov1Path, JSON.stringify(coverage1, null, 2) + "\n");
await fs.writeFile(cov2Path, JSON.stringify(coverage2, null, 2) + "\n");
await fs.writeFile(dupPath, JSON.stringify(duplicates, null, 2) + "\n");

console.log(`Audited ${entries.length} entries across ${index.decks.length} decks (${kanjiToWords.size} distinct kanji).`);
console.log(`Kanji in exactly 1 word: ${coverage1.length} → ${cov1Path}`);
console.log(`Kanji in exactly 2 words: ${coverage2.length} → ${cov2Path}`);
console.log(`Duplicates: ${duplicates.length} word forms occur in 2+ places → ${dupPath}`);
