// Audit how high-value multi-sense / multi-POS words are represented across
// decks. For each candidate (by kanji form), list every deck it appears in
// with its type + english, so gaps (a word that *should* span senses/POS but
// only appears once) are visible.
//
// Usage:  node tools/japanese/polysemy-audit.mjs   (reads data/japanese/cards.json)
// Extend the GROUPS map below with more candidate words as coverage grows.
import fs from "node:fs";

const c = JSON.parse(fs.readFileSync("data/japanese/cards.json", "utf8"));

// Candidates grouped by the kind of multi-representation they *should* have.
const GROUPS = {
  "noun ⇄ na-adjective": ["健康", "元気", "安全", "自由", "平和", "危険", "自然", "普通", "特別", "安心", "心配", "満足", "必要", "十分", "正常", "得意", "苦手", "別"],
  "noun/na-adj ⇄ adverb": ["本当", "一番", "全部", "一緒", "結構", "大体", "本気", "別"],
  "content noun ⇄ grammar": ["事", "物", "所", "訳", "筈", "為", "方", "積もり", "程", "うち", "もの", "こと", "ところ", "わけ", "はず", "ため", "つもり"],
  "polysemous content word": ["手", "目", "気", "頭", "口", "道", "先", "元", "中", "上", "下", "間", "顔", "身", "色", "話", "光"],
  "noun ⇄ suru-verb": ["勉強", "練習", "経験", "成功", "失敗", "成長", "変化", "発展", "影響", "信頼"],
};

// Skip reading-text word lists (texts/<slug>/words) — they're surface-form
// reading aids that repeat common words across passages, not part of the
// vocab-coverage picture this audit reasons about.
const decks = c.decks.filter((d) => !d.id.startsWith("texts/"));
function occurrences(form) {
  const hits = [];
  for (const d of decks) for (const e of d.entries) {
    if (e.kanji === form) hits.push({ deck: d.id, type: e.type, english: e.english });
  }
  return hits;
}

for (const [group, words] of Object.entries(GROUPS)) {
  console.log("\n========== " + group + " ==========");
  for (const w of words) {
    const hits = occurrences(w);
    if (!hits.length) { console.log(`\n${w}  —  (NOT PRESENT)`); continue; }
    const types = [...new Set(hits.map((h) => h.type))];
    console.log(`\n${w}  [${hits.length} entr${hits.length === 1 ? "y" : "ies"}, types: ${types.join(", ")}]`);
    for (const h of hits) console.log(`   · ${h.deck}  (${h.type})  ${h.english}`);
  }
}
