// Audit which kanji are USED across the Japanese data (in words and reading-text
// sentences) but are NOT yet covered by a dedicated entry in the kanji/ decks.
// The result is the worklist for building out data/japanese/kanji/.
//
// Writes a throwaway dev-reference report to ./tmp/ (gitignored, never consumed
// by the app):
//
//   tmp/kanji-uncovered.json — [{ kanji, used, sampleWords: [...],
//     sampleSentences: [...] }], sorted most-used first (highest priority).
//
// "Used" = every Han character appearing in a word deck's `kanji` field or in a
// text's sentence. "Covered" = every character that has its own row in a
// kind:"kanji" deck. Run the bundler first (this reads the built bundle).
//
// Usage: node tools/japanese/kanji-coverage.mjs

import fs from "node:fs/promises";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const dataRoot = path.join(repoRoot, "data", "japanese");
const OUT_DIR = path.join(repoRoot, "tmp");
const SAMPLE_LIMIT = 8;

// 々 (iteration mark) and 〆 are not kanji — exclude them from "used".
const NON_KANJI = new Set([..."々〆ヶ"]);
const isHan = (ch) => /\p{Script=Han}/u.test(ch) && !NON_KANJI.has(ch);
const hanChars = (str) => [...String(str || "")].filter(isHan);

const bundle = JSON.parse(await fs.readFile(path.join(dataRoot, "cards.json"), "utf8"));

// --- Covered: every character with its own row in a kanji/ deck ---
const covered = new Set();
for (const deck of bundle.decks || []) {
  if (deck.kind !== "kanji") continue;
  for (const row of deck.entries || []) for (const ch of hanChars(row.kanji)) covered.add(ch);
}

// --- Used: Han chars in word decks (`kanji` field) and in text sentences ---
const used = new Map(); // char -> { count, words:Set, sentences:[] }
const touch = (ch) => {
  if (!used.has(ch)) used.set(ch, { count: 0, words: new Set(), sentences: [] });
  return used.get(ch);
};
for (const deck of bundle.decks || []) {
  if (deck.kind === "kanji") continue; // the kanji decks define coverage, not usage
  for (const row of deck.entries || []) {
    const word = row.kanji || "";
    for (const ch of new Set(hanChars(word))) {
      const rec = touch(ch);
      rec.count += 1;
      if (rec.words.size < SAMPLE_LIMIT) rec.words.add(word);
    }
  }
}
for (const t of bundle.texts || []) {
  for (const s of t.sentences || []) {
    for (const ch of new Set(hanChars(s.japanese))) {
      const rec = touch(ch);
      rec.count += 1;
      if (rec.sentences.length < SAMPLE_LIMIT) rec.sentences.push(s.japanese);
    }
  }
}

// --- Uncovered = used − covered, most-used first ---
const uncovered = [...used.entries()]
  .filter(([ch]) => !covered.has(ch))
  .map(([kanji, rec]) => ({
    kanji,
    used: rec.count,
    sampleWords: [...rec.words].sort(),
    sampleSentences: rec.sentences
  }))
  .sort((a, b) => b.used - a.used || a.kanji.codePointAt(0) - b.kanji.codePointAt(0));

await fs.mkdir(OUT_DIR, { recursive: true });
const outPath = path.join(OUT_DIR, "kanji-uncovered.json");
await fs.writeFile(outPath, JSON.stringify(uncovered, null, 2) + "\n");

const distinctUsed = used.size;
console.log(`Used kanji: ${distinctUsed} distinct · Covered by kanji/ decks: ${covered.size}`);
console.log(`Uncovered: ${uncovered.length} → ${outPath}`);
if (uncovered.length) {
  const top = uncovered.slice(0, 20).map((r) => r.kanji).join(" ");
  console.log(`Most-used uncovered (top 20): ${top}`);
}
