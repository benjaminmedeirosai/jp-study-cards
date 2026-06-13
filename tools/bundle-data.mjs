// Bundle a language's per-deck data files into data/<lang>/cards.json, the
// single file the app fetches once at startup (instead of one request per deck).
//
// data/<lang>/ IS the source of truth — there is no manifest. This script walks
// the tree, and for each .tsv deck derives everything from its location + name:
//
//   data/japanese/words/adjectives/na-adjectives/qualities.tsv
//                 └────────────── category ─────────────┘ └ label
//
//   • id       = path under data/<lang>/ minus extension  (words/adjectives/na-adjectives/qualities)
//   • category = ancestor folders, title-cased, joined " / "  ("Words / Adjectives / Na Adjectives")
//   • label    = title-cased filename ("Qualities"), unless the deck overrides
//                it with a `# label: ...` line in its header.
//   • count    = number of entries, derived from the rows.
//
// Each language declares its TSV schema in SCHEMAS below (column headers, any
// optional trailing columns, and whether it has reading "texts"). Add a deck by
// dropping a .tsv in the right folder; rename/move to recategorize.
//
// Usage:
//   node tools/bundle-data.mjs            # bundle every language in SCHEMAS
//   node tools/bundle-data.mjs japanese   # bundle just one language
//
// Reading texts (Japanese only for now) live under data/<lang>/texts/<slug>/ and
// are emitted to a separate `texts` array: blob.txt is the reference paragraph,
// sentences.tsv splits it, and words.tsv is an ordinary studyable deck.
//
// data/<lang>/cards.json is generated — never hand-edit it.

import fs from "node:fs/promises";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const dataRoot = path.join(repoRoot, "data");

// Per-language data schema. `headers` are the required leading TSV columns;
// `optional` are extra trailing columns carried through only when non-empty;
// `texts` enables the reading-text (blob/sentences) special-casing.
//
// `subschemas` lets one subtree of a language use different columns: a deck
// whose path starts with `prefix` is parsed against that subschema's headers
// and stamped with its `kind` (so the app can render it differently). Japanese
// uses this for the per-character kanji decks under `kanji/`, which have nothing
// in common with the word columns. Onyomi is katakana, kunyomi hiragana (with a
// `.` before okurigana), readings/components are 、-separated, meanings ;-separated.
const SCHEMAS = {
  japanese: {
    headers: ["kanji", "hiragana", "type", "english"],
    optional: ["breakdown"],
    texts: true,
    subschemas: [
      {
        prefix: "kanji/",
        kind: "kanji",
        headers: ["kanji", "onyomi", "kunyomi", "meaning", "radical", "radical-name", "components"],
        optional: ["strokes", "grade"]
      }
    ]
  },
  spanish: { headers: ["spanish", "type", "english"], optional: [], texts: false },
  farsi: {
    headers: ["word", "vocalized", "label", "meaning"],
    optional: [],
    texts: false,
    subschemas: [
      {
        prefix: "alphabet/",
        kind: "alpha",
        headers: ["index", "isolated", "initial", "medial", "final", "name", "name_fa"],
        optional: []
      },
      {
        prefix: "harakat/",
        kind: "harakat",
        headers: ["index", "mark", "name", "name_fa", "effect", "ex1", "ex1_rom", "ex2", "ex2_rom", "ex3", "ex3_rom", "ex4", "ex4_rom"],
        optional: []
      }
    ]
  }
};
const SENTENCE_HEADERS = ["japanese", "english"];

// "na-adjectives" -> "Na Adjectives"; "food" -> "Food"
function titleCase(segment) {
  return segment
    .split("-")
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(" ");
}

// Split a source into non-blank, non-comment lines, pulling a `# label: ...`
// header directive out as a display-name override.
function readLines(source) {
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
  return { label, lines };
}

// Parse a .tsv deck against the language schema. Required columns lead; optional
// columns follow (only carried through when present and non-empty, so the
// bundle stays lean).
function parseTsv(source, file, schema) {
  const { label, lines } = readLines(source);
  if (!lines.length) return { label, entries: [] };
  const headers = lines[0].split("\t").map((header) => header.trim());
  if (!schema.headers.every((header, index) => headers[index] === header)) {
    throw new Error(`${file}: expected TSV header ${schema.headers.join("\\t")}`);
  }
  const optional = schema.optional.filter((name, index) => headers[schema.headers.length + index] === name);
  const entries = lines.slice(1).map((line) => {
    const fields = line.split("\t");
    const entry = Object.fromEntries(schema.headers.map((header, index) => [header, (fields[index] || "").trim()]));
    optional.forEach((name, index) => {
      const value = (fields[schema.headers.length + index] || "").trim();
      if (value) entry[name] = value;
    });
    return entry;
  });
  return { label, entries };
}

// Parse a texts/<slug>/sentences.tsv: same comment/`# label:` rules, but a
// `japanese / english` header — one row per sentence.
function parseSentences(source, file) {
  const { label, lines } = readLines(source);
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

// Recursively collect every .tsv (deck/sentence data) and .txt (blob) under dir.
async function walk(dir) {
  const out = [];
  for (const dirent of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, dirent.name);
    if (dirent.isDirectory()) out.push(...await walk(full));
    else if (dirent.isFile() && (dirent.name.endsWith(".tsv") || dirent.name.endsWith(".txt"))) out.push(full);
  }
  return out;
}

// A deck whose path matches a library subschema (e.g. data/japanese/kanji/*)
// uses different columns and is tagged with that `kind`. Returns the schema to
// parse against plus the deck kind (null → the language's default word schema).
function resolveDeckSchema(rel, schema) {
  for (const sub of schema.subschemas || []) {
    if (rel.startsWith(sub.prefix)) return { parse: sub, kind: sub.kind };
  }
  return { parse: schema, kind: null };
}

// A file under texts/ is "reading-text aux" (folded into a `texts` entry, not a
// deck) when it's the blob or the sentence split. words.tsv is NOT aux — it
// falls through to the normal deck path so it stays studyable.
function textAuxKind(rel) {
  if (!rel.startsWith("texts/")) return null;
  const base = rel.split("/").pop();
  if (base === "blob.txt") return "blob";
  if (base === "sentences.tsv") return "sentences";
  return null;
}

// Bundle one language's tree under data/<lang>/ into data/<lang>/cards.json.
async function bundleLanguage(lang, schema) {
  const langRoot = path.join(dataRoot, lang);
  const files = (await walk(langRoot)).sort();
  const decks = [];
  const textSets = new Map(); // "texts/<slug>" -> { blob, sentences, label, wordsDeckId }
  const textSet = (id) => {
    if (!textSets.has(id)) textSets.set(id, { blob: "", sentences: [], label: null, wordsDeckId: null });
    return textSets.get(id);
  };

  for (const file of files) {
    const rel = path.relative(langRoot, file).replace(/\\/g, "/");
    const aux = schema.texts ? textAuxKind(rel) : null;
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
    const { parse: deckSchema, kind } = resolveDeckSchema(rel, schema);
    const { label: labelOverride, entries } = parseTsv(await fs.readFile(file, "utf8"), rel, deckSchema);
    const deck = {
      id,
      label: labelOverride || titleCase(fileSeg),
      category: segments.map(titleCase).join(" / "),
      count: entries.length,
      entries
    };
    if (kind) deck.kind = kind;
    decks.push(deck);
    // A texts/<slug>/words.tsv deck is also the text set's vocab list.
    if (schema.texts && rel.startsWith("texts/") && fileSeg === "words") {
      textSet(segments.join("/")).wordsDeckId = id;
    }
  }

  // Assemble the `texts` array: one entry per texts/<slug>/ folder.
  const texts = [...textSets.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([id, set]) => ({
    id,
    label: set.label || titleCase(id.split("/").pop()),
    category: titleCase(id.split("/")[0]), // "Texts"
    blob: set.blob,
    sentences: set.sentences,
    wordsDeckId: set.wordsDeckId
  }));

  const bundle = { version: "data", language: lang, generatedAt: new Date().toISOString(), decks, texts };
  await fs.writeFile(path.join(langRoot, "cards.json"), JSON.stringify(bundle));
  const total = decks.reduce((sum, deck) => sum + deck.count, 0);
  const sentenceCount = texts.reduce((sum, t) => sum + t.sentences.length, 0);
  console.log(`[${lang}] ${decks.length} decks · ${total} entries · ${texts.length} texts (${sentenceCount} sentences) → data/${lang}/cards.json`);
}

const requested = process.argv[2];
const langs = requested ? [requested] : Object.keys(SCHEMAS);
for (const lang of langs) {
  const schema = SCHEMAS[lang];
  if (!schema) {
    console.error(`Unknown language "${lang}". Known: ${Object.keys(SCHEMAS).join(", ")}`);
    process.exitCode = 1;
    continue;
  }
  await bundleLanguage(lang, schema);
}
