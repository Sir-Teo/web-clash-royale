# Clash Royale · Browser Arena

A private, independent browser fan game for Sir-Teo. Built with TypeScript, Three.js and Vite. No account, API key, or backend is required to play.

Build an eight-card deck from 24 cards, deploy troops and spells in a real-time arena battle, and take down the opposing King Tower. Includes three battle modes, complete native troop animations and projectile artwork, Goblin Stadium scenery reconstructed from archived exports and placements, audio, local progression, victory chests and match replays.

Combat includes cancellable attack windups, defensive building pulls, homing shots, ballistic bombs, Fireball travel and knockback, three-wave Arrows and Zap charge resets. Existing version-1 replays retain their original rules; new matches record version-2 combat.

This version supports AI opponents. Online multiplayer, the full live card roster and current balance parity are not implemented.

## Development

```sh
npm ci
npm run dev
```

`npm run check` runs simulation and persistence tests, type checking and a production build. `npm run test:e2e` runs desktop Chromium and phone Chromium/WebKit browser tests (install both once with `npx playwright install chromium webkit`). Assets and fonts are bundled locally. The production build generates an offline cache; after its first complete load, the game can reload and start battles without a network connection.

To verify offline behavior, run `npm run preview -- --host 127.0.0.1 --port 5189 --strictPort` and then `npm run test:offline`.

`npm run assets` refreshes cards, renders and audio. `npm run assets:sprites` imports complete native animation sequences and lossless textures; `npm run assets:scenery` reconstructs tower and arena textures from the retained metadata. No asset generation is needed for normal development.

`npm run assets:combat` regenerates combat traits from retained historical CSVs. `npm run assets:effects` imports the original projectile and electrical-effect clips. Development inspection pages are available at `/tests/fixtures/animations.html`, `/tests/fixtures/effects.html` and `/tests/fixtures/combat.html`; they are excluded from the production build.

## Phone play

Open the Vite **Network** URL on a phone connected to the same Wi-Fi as the development computer. `localhost` on a phone refers to the phone itself. Portrait battles fill the available browser height; rotating into landscape moves the hand alongside the arena. Safe-area padding keeps controls away from display cutouts and the home indicator. Tap a card and then the arena, or drag a card onto the battlefield. Pause and settings use 44-pixel touch targets. Battle progress pauses when the browser goes into the background.

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
