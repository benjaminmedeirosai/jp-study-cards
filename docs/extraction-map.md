# Extraction Map

Source repo: `/Users/benjaminmedeiros/Developer/benjaminmedeirosai/study_cards`

Target repo: `/Users/benjaminmedeiros/Developer/benjaminmedeirosai/jp-study-cards`

## App Code

Move/adapt these pieces next:

- `src/pages/japaneseStudyPage/japaneseStudyPage.js` -> `src/study/japaneseStudy.js`, `deckModel.js`, `state.js`, `links.js`
- `src/pages/japaneseStudyPage/japaneseStudyPage.css` -> `src/styles.css` plus study-specific CSS
- `src/utils/browser/speech.js` -> `src/study/speech.js` with shell/store dependencies removed

Replace main-repo dependencies:

- `store.apps.getState/setState` -> `localStorage`
- `store.collections.loadCollection` -> `fetch(deck.path)` from `/data/index.json`
- shell lifecycle handlers -> direct app bootstrap in `src/main.js`
- shell chrome hiding -> not needed

## Study Data

The new data model is folder-first and simplified. Generate it with:

```bash
node tools/generate-data.mjs
```

Current generated groups include:

- `data/nouns/animals.json`, `food.json`, `places-buildings.json`, `common-N.json`
- `data/proper-nouns/prefectures.json`, `cities-stations-places.json`, `brands-titles.json`
- `data/verbs/ichidan/common-N.json`
- `data/verbs/godan/{u,ku,gu,su,tsu,nu,bu,mu,ru,other}-ending.json`
- additional small type folders for adjectives, counters, expressions, particles, and related cards

Each deck is a JSON array of records with only:

```json
{
  "kanji": "",
  "hiragana": "",
  "type": "",
  "english": ""
}
```
