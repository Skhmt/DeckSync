# DeckSync

Maybe you're a judge and want to validate someone's deck? Maybe you're someone who tinkers with their deck a lot and it has over time become *desynchronized* with your online deck list? DeckSync lets you easily check if a cardboard stack matches a digital deck list.

It's a static single page application that can be installed as a progressive web app. Built in Svelte/DaisyUI/Vite.

*This is **NOT** a deck builder.*

## To-do

- Add a modal where you can tap a card and quickly get oracle text (maybe? feels like scope creep)

## Development

Install deps: `npm i`

Build: `npm run build`

Dev server: `npm run dev`

### Card data pre-build step

`dev` and `build` first run `scripts/prepare-data.js`, which downloads MTGJSON v5
card data (cached in `scripts/.cache/` for 7 days) and generates
`public/card-data.json`: a list of all card names plus a
`set:collector number → Scryfall id` index. The app loads it on launch so the
card scanner can validate OCR readings locally — unknown set/number pairs and
garbage names are rejected without any Scryfall API call, and known printings
resolve via the local IndexedDB cache (zero API calls after the first scan).

- Force a data refresh: `DECKSYNC_FORCE_DATA=1 npm run prepare:data`
- The generated file and download cache are gitignored; the script fails soft
  (keeps the previous data) when offline.

