# Folder Structure

```text
jp-study-cards/
  index.html                 # Static app entry
  manifest.webmanifest       # PWA install metadata
  sw.js                      # Offline cache + full data resync handler
  README.md
  docs/
    folder-structure.md
    extraction-map.md
  tools/
    generate-data.mjs        # Regenerates simplified topic decks
  src/
    main.js                  # App bootstrap
    styles.css               # Global/lightweight app styles
    study/
      japaneseStudy.js       # Main study UI module
      deckModel.js           # Deck/set generation
      state.js               # localStorage state
      links.js               # ChatGPT / image links
      speech.js              # browser TTS helper
  data/
    index.json               # Deck manifest consumed by app + service worker
    nouns/
      animals.json
      food.json
      places-buildings.json
      common-1.json
    proper-nouns/
      prefectures.json
      cities-stations-places.json
    verbs/
      ichidan/
        common-1.json
      godan/
        mu-ending.json
        ku-ending.json
  assets/
    icons/                   # PWA icons
```

## Why this shape

- `sw.js` stays at repo root so it can control the whole PWA scope.
- `manifest.webmanifest` stays at repo root for straightforward browser install support.
- `src/study/` keeps all study-specific code together.
- `data/` is separate from code so offline cache resync can refresh generated decks directly.
- `data/index.json` is the only manifest the app needs to discover available topics.
