# Clash Royale · Browser Arena

A private, independent browser fan game for Sir-Teo. Built with TypeScript, Three.js and Vite. No account, API key, or backend is required to play.

## Development

```sh
npm ci
npm run dev
```

`npm run check` runs simulation tests, type checking and a production build. `npm run test:e2e` runs the browser smoke tests. Assets are bundled locally; `npm run assets` refreshes the curated asset set.

## Implementation steps

1. Project foundation and reproducible asset imports.
2. Deterministic battle simulation, card roster, AI and rules.
3. Animated 3D arena and battle effects.
4. Lobby, deck builder, battle controls and local progression.
5. Browser playtesting, fixes and documentation.

This project is unofficial and is not affiliated with, endorsed, sponsored, or specifically approved by Supercell. Clash Royale artwork, audio and trademarks belong to Supercell. See `docs/ASSETS.md` for sources. Bundled artwork is not covered by any code license.
