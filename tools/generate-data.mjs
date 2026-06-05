import fs from 'node:fs/promises';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');
const defaultSource = path.resolve(repoRoot, '../study_cards/collections/japanese/japanese_words.json');
const sourcePath = process.env.JP_WORDS_SOURCE ? path.resolve(process.env.JP_WORDS_SOURCE) : defaultSource;
const dataRoot = path.join(repoRoot, 'data');
const chunkSize = 50;

const GODAN_ENDINGS = new Set(['う', 'く', 'ぐ', 'す', 'つ', 'ぬ', 'ぶ', 'む', 'る']);
const GODAN_ROMAJI = new Map([
  ['う', 'u'], ['く', 'ku'], ['ぐ', 'gu'], ['す', 'su'], ['つ', 'tsu'],
  ['ぬ', 'nu'], ['ぶ', 'bu'], ['む', 'mu'], ['る', 'ru'], ['other', 'other'],
]);

function cleanString(value) {
  return String(value ?? '').trim();
}

function simplify(entry) {
  return {
    kanji: cleanString(entry.kanji),
    hiragana: cleanString(entry.reading),
    type: cleanString(entry.type),
    english: cleanString(entry.meaning),
  };
}

function tags(entry) {
  return Array.isArray(entry.tags) ? entry.tags.map(cleanString) : [];
}

function hasAnyTag(entry, needles) {
  const set = new Set(tags(entry));
  return needles.some((tag) => set.has(tag));
}

function getGodanEnding(entry) {
  const chars = Array.from(cleanString(entry.reading) || cleanString(entry.kanji));
  const ending = chars.at(-1) || '';
  return GODAN_ENDINGS.has(ending) ? ending : 'other';
}

function chunk(items, size = chunkSize) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

function isPrefecture(entry) {
  const english = cleanString(entry.meaning).toLowerCase();
  const kanji = cleanString(entry.kanji);
  return english.includes('prefecture') || english.includes('metropolis') || kanji === '北海道';
}

function isCityStationPlace(entry) {
  const english = cleanString(entry.meaning).toLowerCase();
  return /\b(city|station|town|place name|village|new york|hawaii|kyoto|kumamoto)\b/.test(english);
}

function isBrandOrTitle(entry) {
  return hasAnyTag(entry, ['brand', 'publisher', 'zodiac']) || /publisher|brand|zodiac/i.test(cleanString(entry.meaning));
}

function isPlaceBuildingNoun(entry) {
  const english = cleanString(entry.meaning).toLowerCase();
  const kanji = cleanString(entry.kanji);
  return /\b(building|station|city|town|village|school|room|store|shop|house|home|hotel|restaurant|temple|shrine|castle|kingdom|space)\b/.test(english)
    || /[駅市町村校店家屋室国]$/.test(kanji);
}

function deck(pathname, label, category, entries) {
  return { pathname, label, category, entries: entries.map(simplify).filter((entry) => entry.kanji || entry.hiragana) };
}

function chunkDecks(basePath, baseLabel, category, entries) {
  return chunk(entries).map((items, index) => deck(`${basePath}/common-${index + 1}.json`, `${baseLabel} ${index + 1}`, category, items));
}

function uniqueDeckEntries(decks) {
  const seen = new Set();
  for (const d of decks) {
    d.entries = d.entries.filter((entry) => {
      const key = `${entry.kanji}|${entry.hiragana}|${entry.english}`;
      if (seen.has(`${d.pathname}|${key}`)) return false;
      seen.add(`${d.pathname}|${key}`);
      return true;
    });
  }
}

async function resetDataDir() {
  await fs.rm(dataRoot, { recursive: true, force: true });
  await fs.mkdir(dataRoot, { recursive: true });
}

async function writeDecks(decks) {
  const index = { generatedAt: new Date().toISOString(), decks: [] };
  for (const d of decks.filter((item) => item.entries.length)) {
    const file = path.join(dataRoot, d.pathname);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, `${JSON.stringify(d.entries, null, 2)}\n`);
    index.decks.push({
      id: d.pathname.replace(/\.json$/, ''),
      label: d.label,
      category: d.category,
      path: `/data/${d.pathname}`,
      count: d.entries.length,
    });
  }
  await fs.writeFile(path.join(dataRoot, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
  return index;
}

const raw = JSON.parse(await fs.readFile(sourcePath, 'utf8'));
const entries = Array.isArray(raw.entries) ? raw.entries : [];
const byType = (type) => entries.filter((entry) => cleanString(entry.type) === type);
const decks = [];

const nouns = byType('noun');
const nounAnimals = nouns.filter((entry) => hasAnyTag(entry, ['common_animal', 'animal_compound']));
const nounFood = nouns.filter((entry) => hasAnyTag(entry, ['food', 'refrigerator_common']));
const nounPlaces = nouns.filter(isPlaceBuildingNoun);
const nounFeatured = new Set([...nounAnimals, ...nounFood, ...nounPlaces]);
decks.push(deck('nouns/animals.json', 'Animals', 'Nouns', nounAnimals));
decks.push(deck('nouns/food.json', 'Food', 'Nouns', nounFood));
decks.push(deck('nouns/places-buildings.json', 'Places & Buildings', 'Nouns', nounPlaces));
decks.push(...chunkDecks('nouns', 'Nouns', 'Nouns', nouns.filter((entry) => !nounFeatured.has(entry))));

const properNouns = byType('proper-noun');
const prefectures = properNouns.filter(isPrefecture);
const places = properNouns.filter((entry) => !prefectures.includes(entry) && isCityStationPlace(entry));
const brands = properNouns.filter((entry) => !prefectures.includes(entry) && !places.includes(entry) && isBrandOrTitle(entry));
const properFeatured = new Set([...prefectures, ...places, ...brands]);
decks.push(deck('proper-nouns/prefectures.json', 'Prefectures', 'Proper Nouns', prefectures));
decks.push(deck('proper-nouns/cities-stations-places.json', 'Cities, Stations & Places', 'Proper Nouns', places));
decks.push(deck('proper-nouns/brands-titles.json', 'Brands & Titles', 'Proper Nouns', brands));
decks.push(...chunkDecks('proper-nouns', 'Proper Nouns', 'Proper Nouns', properNouns.filter((entry) => !properFeatured.has(entry))));

decks.push(...chunkDecks('verbs/ichidan', 'Ichidan Verbs', 'Verbs / Ichidan', byType('ichidan-verb')));
for (const ending of [...GODAN_ENDINGS, 'other']) {
  const label = `${GODAN_ROMAJI.get(ending)} ending`;
  decks.push(deck(`verbs/godan/${GODAN_ROMAJI.get(ending)}-ending.json`, `Godan ${label}`, 'Verbs / Godan', byType('godan-verb').filter((entry) => getGodanEnding(entry) === ending)));
}
decks.push(deck('verbs/irregular/common.json', 'Irregular Verbs', 'Verbs / Irregular', byType('irregular-verb')));

for (const [type, category, label] of [
  ['i-adjective', 'Adjectives', 'I-adjectives'],
  ['na-adjective', 'Adjectives', 'Na-adjectives'],
  ['adverb', 'Adverbs', 'Adverbs'],
  ['counter', 'Counters', 'Counters'],
  ['expression', 'Expressions', 'Expressions'],
  ['descriptive-phrase', 'Expressions', 'Descriptive Phrases'],
  ['particle', 'Grammar', 'Particles'],
  ['conjunction', 'Grammar', 'Conjunctions'],
  ['numeral', 'Numbers', 'Numerals'],
  ['morpheme', 'Grammar', 'Morphemes'],
  ['phrase-sentence', 'Expressions', 'Phrase Sentences'],
]) {
  decks.push(...chunkDecks(type.replace(/-/g, '-'), label, category, byType(type)));
}

uniqueDeckEntries(decks);
await resetDataDir();
const index = await writeDecks(decks);
console.log(`Generated ${index.decks.length} decks from ${entries.length} source entries.`);
console.log(`Wrote ${path.join(dataRoot, 'index.json')}`);
