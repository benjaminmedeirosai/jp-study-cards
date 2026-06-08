// Bundle the per-deck data files into a single data/cards.json that the app
// fetches once at startup (instead of ~90 individual requests).
//
// Reads whatever data/index.json currently references — JSON or TSV deck files —
// so it preserves hand-curated decks rather than regenerating from source.
// The per-file data stays in the repo as the editable source; cards.json is the
// built runtime artifact.
//
// Card counts are derived here from each deck's actual rows — index.json carries
// no count field, so there's nothing to hand-maintain or let drift.
//
// Usage: node tools/bundle-data.mjs

import fs from "node:fs/promises";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const dataRoot = path.join(repoRoot, "data");
const REQUIRED_HEADERS = ["kanji", "hiragana", "type", "english"];

function parseTsv(source, file) {
  // Skip blank lines and `#` comment lines (used for in-file header notes
  // describing what belongs in each deck).
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

const index = JSON.parse(await fs.readFile(path.join(dataRoot, "index.json"), "utf8"));
const decks = [];
for (const deck of index.decks || []) {
  const rel = String(deck.path).replace(/^\/data\//, "");
  const raw = await fs.readFile(path.join(dataRoot, rel), "utf8");
  const entries = rel.endsWith(".tsv") ? parseTsv(raw, rel) : JSON.parse(raw);
  decks.push({
    id: deck.id,
    label: deck.label,
    category: deck.category,
    count: entries.length,
    entries
  });
}

const bundle = {
  version: String(index.version || index.generatedAt || "data"),
  generatedAt: index.generatedAt || new Date().toISOString(),
  decks
};

await fs.writeFile(path.join(dataRoot, "cards.json"), JSON.stringify(bundle));
const total = decks.reduce((sum, deck) => sum + deck.count, 0);
console.log(`Bundled ${decks.length} decks · ${total} entries → data/cards.json`);
