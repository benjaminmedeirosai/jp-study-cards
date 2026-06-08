// Generate the per-counter TSV decks under data/counter/.
// Each counter gets its own file with the full 1-N range and correct readings
// (irregular sound-changes spelled out explicitly). Safe to re-run: it only
// writes data/counter/*.tsv. The generated TSVs are the committed source the
// bundler reads — edit a reading here and re-run, rather than editing the TSV
// by hand, so regeneration stays lossless.
//
// Usage: node tools/generate-counters.mjs

import fs from "node:fs/promises";
import path from "node:path";

const dir = path.resolve(import.meta.dirname, "..", "data", "counter");

const DIGITS = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
function kanjiNum(n) {
  if (n < 10) return DIGITS[n];
  if (n === 10) return "十";
  if (n < 20) return "十" + DIGITS[n - 10];
  if (n === 20) return "二十";
  return String(n);
}

// readings[i] is the reading for (i+1). unit is the English noun phrase.
const COUNTERS = [
  {
    file: "tsu", counter: "つ", label: "〜つ (native counter)",
    unit: "things (native counting)", kanjiFn: (n) => (n === 10 ? "十" : DIGITS[n] + "つ"),
    note: "# All native (kun) readings; only goes to 10 (十 = とお). Use 〜個 beyond that.",
    readings: ["ひとつ", "ふたつ", "みっつ", "よっつ", "いつつ", "むっつ", "ななつ", "やっつ", "ここのつ", "とお"],
  },
  {
    file: "nin", counter: "人", label: "〜人 (people)", unit: "people",
    note: "# Irregular: 1 ひとり, 2 ふたり, 4 よにん (and 14 じゅうよにん).",
    readings: ["ひとり", "ふたり", "さんにん", "よにん", "ごにん", "ろくにん", "ななにん", "はちにん", "きゅうにん", "じゅうにん", "じゅういちにん", "じゅうににん", "じゅうさんにん", "じゅうよにん", "じゅうごにん", "じゅうろくにん", "じゅうななにん", "じゅうはちにん", "じゅうきゅうにん", "にじゅうにん"],
  },
  {
    file: "hon", counter: "本", label: "〜本 (long objects)", unit: "long cylindrical objects",
    note: "# Irregular: 1 いっぽん, 3 さんぼん, 6 ろっぽん, 8 はっぽん, 10 じゅっぽん (repeats at 11-, 20).",
    readings: ["いっぽん", "にほん", "さんぼん", "よんほん", "ごほん", "ろっぽん", "ななほん", "はっぽん", "きゅうほん", "じゅっぽん", "じゅういっぽん", "じゅうにほん", "じゅうさんぼん", "じゅうよんほん", "じゅうごほん", "じゅうろっぽん", "じゅうななほん", "じゅうはっぽん", "じゅうきゅうほん", "にじゅっぽん"],
  },
  {
    file: "mai", counter: "枚", label: "〜枚 (flat objects)", unit: "flat objects",
    note: "# Fully regular — no sound changes.",
    readings: ["いちまい", "にまい", "さんまい", "よんまい", "ごまい", "ろくまい", "ななまい", "はちまい", "きゅうまい", "じゅうまい", "じゅういちまい", "じゅうにまい", "じゅうさんまい", "じゅうよんまい", "じゅうごまい", "じゅうろくまい", "じゅうななまい", "じゅうはちまい", "じゅうきゅうまい", "にじゅうまい"],
  },
  {
    file: "ko", counter: "個", label: "〜個 (small objects)", unit: "small objects",
    note: "# Irregular: 1 いっこ, 6 ろっこ, 8 はっこ, 10 じゅっこ (repeats at 11-, 20).",
    readings: ["いっこ", "にこ", "さんこ", "よんこ", "ごこ", "ろっこ", "ななこ", "はっこ", "きゅうこ", "じゅっこ", "じゅういっこ", "じゅうにこ", "じゅうさんこ", "じゅうよんこ", "じゅうごこ", "じゅうろっこ", "じゅうななこ", "じゅうはっこ", "じゅうきゅうこ", "にじゅっこ"],
  },
  {
    file: "hiki", counter: "匹", label: "〜匹 (small animals)", unit: "small animals",
    note: "# Irregular: 1 いっぴき, 3 さんびき, 6 ろっぴき, 8 はっぴき, 10 じゅっぴき.",
    readings: ["いっぴき", "にひき", "さんびき", "よんひき", "ごひき", "ろっぴき", "ななひき", "はっぴき", "きゅうひき", "じゅっぴき", "じゅういっぴき", "じゅうにひき", "じゅうさんびき", "じゅうよんひき", "じゅうごひき", "じゅうろっぴき", "じゅうななひき", "じゅうはっぴき", "じゅうきゅうひき", "にじゅっぴき"],
  },
  {
    file: "hai", counter: "杯", label: "〜杯 (cupfuls)", unit: "cups/glassfuls",
    note: "# Irregular: 1 いっぱい, 3 さんばい, 6 ろっぱい, 8 はっぱい, 10 じゅっぱい.",
    readings: ["いっぱい", "にはい", "さんばい", "よんはい", "ごはい", "ろっぱい", "ななはい", "はっぱい", "きゅうはい", "じゅっぱい", "じゅういっぱい", "じゅうにはい", "じゅうさんばい", "じゅうよんはい", "じゅうごはい", "じゅうろっぱい", "じゅうななはい", "じゅうはっぱい", "じゅうきゅうはい", "にじゅっぱい"],
  },
  {
    file: "satsu", counter: "冊", label: "〜冊 (books)", unit: "bound volumes",
    note: "# Irregular: 1 いっさつ, 8 はっさつ, 10 じゅっさつ.",
    readings: ["いっさつ", "にさつ", "さんさつ", "よんさつ", "ごさつ", "ろくさつ", "ななさつ", "はっさつ", "きゅうさつ", "じゅっさつ", "じゅういっさつ", "じゅうにさつ", "じゅうさんさつ", "じゅうよんさつ", "じゅうごさつ", "じゅうろくさつ", "じゅうななさつ", "じゅうはっさつ", "じゅうきゅうさつ", "にじゅっさつ"],
  },
  {
    file: "kai", counter: "回", label: "〜回 (times)", unit: "times/occurrences",
    note: "# Irregular: 1 いっかい, 6 ろっかい, 8 はっかい, 10 じゅっかい.",
    readings: ["いっかい", "にかい", "さんかい", "よんかい", "ごかい", "ろっかい", "ななかい", "はっかい", "きゅうかい", "じゅっかい", "じゅういっかい", "じゅうにかい", "じゅうさんかい", "じゅうよんかい", "じゅうごかい", "じゅうろっかい", "じゅうななかい", "じゅうはっかい", "じゅうきゅうかい", "にじゅっかい"],
  },
  {
    file: "fun", counter: "分", label: "〜分 (minutes)", unit: "minutes",
    note: "# Irregular: 1 いっぷん, 3 さんぷん, 4 よんぷん, 6 ろっぷん, 8 はっぷん, 10 じゅっぷん.",
    readings: ["いっぷん", "にふん", "さんぷん", "よんぷん", "ごふん", "ろっぷん", "ななふん", "はっぷん", "きゅうふん", "じゅっぷん", "じゅういっぷん", "じゅうにふん", "じゅうさんぷん", "じゅうよんぷん", "じゅうごふん", "じゅうろっぷん", "じゅうななふん", "じゅうはっぷん", "じゅうきゅうふん", "にじゅっぷん"],
  },
  {
    file: "sai", counter: "歳", label: "〜歳 (age)", unit: "years old",
    note: "# Irregular: 1 いっさい, 8 はっさい, 10 じゅっさい, 20 はたち (二十歳).",
    readings: ["いっさい", "にさい", "さんさい", "よんさい", "ごさい", "ろくさい", "ななさい", "はっさい", "きゅうさい", "じゅっさい", "じゅういっさい", "じゅうにさい", "じゅうさんさい", "じゅうよんさい", "じゅうごさい", "じゅうろくさい", "じゅうななさい", "じゅうはっさい", "じゅうきゅうさい", "はたち"],
  },
  {
    file: "dai", counter: "台", label: "〜台 (machines/vehicles)", unit: "machines/vehicles",
    note: "# Fully regular — no sound changes.",
    readings: ["いちだい", "にだい", "さんだい", "よんだい", "ごだい", "ろくだい", "ななだい", "はちだい", "きゅうだい", "じゅうだい", "じゅういちだい", "じゅうにだい", "じゅうさんだい", "じゅうよんだい", "じゅうごだい", "じゅうろくだい", "じゅうななだい", "じゅうはちだい", "じゅうきゅうだい", "にじゅうだい"],
  },
  {
    file: "do", counter: "度", label: "〜度 (times/degrees)", unit: "times/degrees",
    note: "# Fully regular — no sound changes.",
    readings: ["いちど", "にど", "さんど", "よんど", "ごど", "ろくど", "ななど", "はちど", "きゅうど", "じゅうど", "じゅういちど", "じゅうにど", "じゅうさんど", "じゅうよんど", "じゅうごど", "じゅうろくど", "じゅうななど", "じゅうはちど", "じゅうきゅうど", "にじゅうど"],
  },
  {
    file: "en", counter: "円", label: "〜円 (yen)", unit: "yen",
    note: "# Regular except 4 よえん (14 じゅうよえん).",
    readings: ["いちえん", "にえん", "さんえん", "よえん", "ごえん", "ろくえん", "ななえん", "はちえん", "きゅうえん", "じゅうえん", "じゅういちえん", "じゅうにえん", "じゅうさんえん", "じゅうよえん", "じゅうごえん", "じゅうろくえん", "じゅうななえん", "じゅうはちえん", "じゅうきゅうえん", "にじゅうえん"],
  },
  {
    file: "wari", counter: "割", label: "〜割 (10% units)", unit: "tenths (10% units)",
    note: "# Percentage/proportion units; 十割 = 100%. Fully regular.",
    readings: ["いちわり", "にわり", "さんわり", "よんわり", "ごわり", "ろくわり", "ななわり", "はちわり", "きゅうわり", "じゅうわり"],
  },
];

const HEADER = "kanji\thiragana\ttype\tenglish";

for (const c of COUNTERS) {
  const kanjiFn = c.kanjiFn || ((n) => kanjiNum(n) + c.counter);
  const lines = [
    `# Counter ${c.label.replace(/^〜/, "〜")} — counts ${c.unit}.`,
    c.note,
    HEADER,
  ];
  c.readings.forEach((reading, i) => {
    const n = i + 1;
    lines.push(`${kanjiFn(n)}\t${reading}\tcounter\t${n} ${c.unit}`);
  });
  const file = path.join(dir, `${c.file}.tsv`);
  await fs.writeFile(file, lines.join("\n") + "\n");
  console.log(`wrote counter/${c.file}.tsv (${c.readings.length})`);
}
