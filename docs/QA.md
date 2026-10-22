# Verification

```sh
npm ci
npm run check
npx playwright install chromium # once on a new machine
npm run test:e2e
```

Simulation coverage includes card cycling, rejected commands, resources, bridge routing, spell tower damage, King activation, three-crown victories, building lifetime, Witch summons, regulation/overtime, tiebreakers and complete replay consistency. Persistence tests cover corrupt saves, deck validation, ranked/training rewards, chest claiming and retention limits.

Browser tests run against an isolated Vite port with strict port selection, in desktop and phone viewports. They replace a deck card and reload, deploy through the actual hand and canvas, check that the hand stays visible, pause and resume, surrender, replay and return home. Settings, collection search, horizontal overflow and uncaught page errors are checked. Screenshots and failure traces are written to `test-results/`.

For manual playtesting, run `npm run dev`, start a battle, build a tank/support push in one lane, defend the other lane and use spells on swarms. Verify troop targeting, air counters, placement previews and the timer. Use keys 1–4 to select a card; Escape cancels a selection or pauses; Space pauses. Touch supports card selection and dragging onto the arena.

The diagnostics object `window.__arena` is read-only and reports current screen, elapsed battle time, selected slot, resources, troop/action counts, render draw calls and recent frame rate. Its `project(x,y)` function exposes coordinate projection for browser tests without allowing simulation mutation.
