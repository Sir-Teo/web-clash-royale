# Clash Royale · Browser Arena

A private, independent browser fan game for Sir-Teo. Built with TypeScript, Three.js and Vite. No account, API key, or backend is required to play.

Build an eight-card deck from 24 cards, deploy troops and spells in a real-time arena battle, and take down the opposing King Tower. Includes three battle modes, original directional troop sprites and tower artwork, Goblin Stadium scenery reconstructed from archived exports and placements, audio, local progression, victory chests and match replays.

This version supports AI opponents. Online multiplayer, the full live card roster and current balance parity are not implemented.

## Development

```sh
npm ci
npm run dev
```

`npm run check` runs simulation and persistence tests, type checking and a production build. `npm run test:e2e` runs desktop and phone browser tests (install Chromium once with `npx playwright install chromium`). Assets and fonts are bundled locally. The production build generates an offline cache; after its first complete load, the game can reload and start battles without a network connection.

To verify offline behavior, run `npm run preview -- --host 127.0.0.1 --port 5189 --strictPort` and then `npm run test:offline`.

`npm run assets` refreshes cards, renders and audio. `npm run assets:sprites` rebuilds troop atlases; `npm run assets:scenery` reconstructs tower and arena textures from the retained metadata. No asset generation is needed for normal development.

## Controls

- Click a hand card, then click the arena, or drag the card into position.
- Keys **1–4** select a card. **Escape** cancels a selection or pauses; **Space** pauses.
- Troops deploy on your half; spells can target either half. Destroying a Princess Tower opens deployment territory in that lane.
- Decks, results and preferences save automatically in this browser.

See [architecture](docs/ARCHITECTURE.md), [asset provenance](docs/ASSETS.md) and [verification](docs/QA.md).

## Implementation steps

1. Project foundation and reproducible asset imports.
2. Deterministic battle simulation, card roster, AI and rules.
3. Original sprite and scenery reconstruction, 3D effects and fallback models.
4. Lobby, deck builder, battle controls and local progression.
5. Desktop/phone playtesting, offline verification and CI.

This project is unofficial and is not affiliated with, endorsed, sponsored, or specifically approved by Supercell. Clash Royale artwork, audio and trademarks belong to Supercell. See `docs/ASSETS.md` for sources. Bundled artwork is not covered by any code license.
