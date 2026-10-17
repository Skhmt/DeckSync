# DeckSync

Maybe you're a judge and want to validate someone's deck? Maybe you're someone who tinkers with their deck a lot and it has over time become *desynchronized* with your online deck list? DeckSync lets you easily check if a cardboard stack matches a digital deck list.

It's a static single page application that can be installed as a progressive web app. Built in Svelte/DaisyUI/Vite.

*This is **NOT** a deck builder.*

## To-do

- Re-center icon
- Fix URL deck imports or just remove it for simplicity
- Add a modal where you can tap a card and quickly get oracle text (maybe? feels like scope creep)
- Minimap/floating legend for the card categories
- When there's multiple of a card, it should be above the name, not below?
- Disable the `-` button below 0 of a card

## Development

Install deps: `npm i`

Build: `npm run build`

Dev server: `npm run dev`
