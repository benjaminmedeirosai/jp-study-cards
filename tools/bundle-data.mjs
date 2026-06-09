// Bundle the per-deck data files into a single data/cards.json that the app
// fetches once at startup (instead of one request per deck).
//
// data/ IS the source of truth — there is no manifest. This script walks the
// tree, and for each .tsv deck derives everything from its location and name:
//
//   data/adjectives/na-adjectives/qualities.tsv
//        └─────────── category ──────────┘ └ label
//
//   • id       = path under data/ minus extension  (adjectives/na-adjectives/qualities)
//   • category = ancestor folders, title-cased, joined " / "  ("Adjectives / Na Adjectives")
//   • label    = title-cased filename ("Qualities"), unless the deck overrides
//                it with a `# label: ...` line in its header (used for labels a
//                filename can't carry, e.g. "〜本 (long objects)", "Meat & Seafood").
//   • count    = number of entries, derived from the rows.
//
// Add a deck by dropping a .tsv in the right folder; rename/move to recategorize.
// Nothing else to update. Then run: node tools/bundle-data.mjs
//
// data/cards.json is generated — never hand-edit it.

import fs from "node:fs/promises";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const dataRoot = path.join(repoRoot, "data");
const REQUIRED_HEADERS = ["kanji", "hiragana", "type", "english"];

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
  const entries = lines.slice(1).map((line) => {
    const fields = line.split("\t");
    return Object.fromEntries(REQUIRED_HEADERS.map((header, index) => [header, (fields[index] || "").trim()]));
  });
  return { label, entries };
}

// Recursively collect every .tsv under data/.
async function walk(dir) {
  const out = [];
  for (const dirent of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, dirent.name);
    if (dirent.isDirectory()) out.push(...await walk(full));
    else if (dirent.isFile() && dirent.name.endsWith(".tsv")) out.push(full);
  }
  return out;
}

const files = (await walk(dataRoot)).sort();
const decks = [];
for (const file of files) {
  const rel = path.relative(dataRoot, file).replace(/\\/g, "/");
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
}

const bundle = {
  version: "data",
  generatedAt: new Date().toISOString(),
  decks
};

await fs.writeFile(path.join(dataRoot, "cards.json"), JSON.stringify(bundle));
const total = decks.reduce((sum, deck) => sum + deck.count, 0);
console.log(`Bundled ${decks.length} decks · ${total} entries → data/cards.json`);
