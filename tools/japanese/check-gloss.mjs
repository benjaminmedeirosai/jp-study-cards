// Validate breakdown glosses for decks whose id starts with argv[2] (empty =
// all): every segment must be `漢: …` with 漢 a single Han char present in the
// word, bracketed, and containing a colon. Prints glossed/total per deck and a
// mismatch count (aim for 0). Rebuild the bundle first:
//   node tools/bundle-data.mjs japanese && node tools/japanese/check-gloss.mjs <prefix>
import fs from "node:fs/promises";
const b = JSON.parse(await fs.readFile(new URL("../../data/japanese/cards.json", import.meta.url), "utf8"));
const prefix = process.argv[2] || "";
const isHan = (c) => /\p{Script=Han}/u.test(c);
const decks = b.decks.filter((d) => d.id.startsWith(prefix));
let bad = [], totalRows = 0, totalGloss = 0;
for (const d of decks) {
  const wb = d.entries.filter((e) => e.breakdown).length;
  totalRows += d.entries.length; totalGloss += wb;
  console.log(d.id.padEnd(34), wb + "/" + d.entries.length);
  for (const e of d.entries) {
    if (!e.breakdown) continue;
    if (!/^\[.*\]$/.test(e.breakdown.trim())) { bad.push(`${d.id}: ${e.kanji} bad-brackets ${e.breakdown}`); continue; }
    const inner = e.breakdown.trim().replace(/^\[/, "").replace(/\]$/, "");
    const segs = inner.split("|").map((s) => s.trim()).filter(Boolean);
    const wk = [...e.kanji].filter(isHan);
    for (const seg of segs) {
      const k = seg.split(":")[0].trim();
      if ([...k].length !== 1 || !isHan(k) || !wk.includes(k)) bad.push(`${d.id}: ${e.kanji} seg=${k}`);
      if (!seg.includes(":")) bad.push(`${d.id}: ${e.kanji} no-colon ${seg}`);
    }
  }
}
console.log(`\n${decks.length} decks · ${totalGloss}/${totalRows} rows glossed · mismatches: ${bad.length}`);
bad.forEach((x) => console.log("  " + x));
