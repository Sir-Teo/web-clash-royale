# Verification

```sh
npm ci
npm run check
npx playwright install chromium webkit # once on a new machine
npm run test:e2e
```

Simulation coverage includes card cycling, rejected commands, resources, bridge routing, spell tower damage, King activation, three-crown victories, building lifetime, Witch summons, regulation/overtime, tiebreakers and complete replay consistency. Persistence tests cover corrupt saves, deck validation, ranked/training rewards, chest claiming and retention limits.

Browser tests run against an isolated Vite port with strict port selection, in desktop Chromium and phone Chromium/WebKit viewports. They replace a deck card and reload, deploy through the actual hand and canvas, check that the hand stays visible, pause and resume, surrender, replay and return home. Settings, collection search, horizontal overflow and uncaught page errors are checked. Screenshots and failure traces are written to `test-results/`.

The production offline check runs against port 5189, waits for the service worker to finish caching the complete game, disables network access, reloads the page and starts a battle. Static cache lookups ignore response `Vary` headers because same-origin Vite previews otherwise give module requests a different `Origin` value from precache requests.

The phone suite rotates a live game through 320×568, 360×640, 375×667, 390×844, 667×375 and 844×390. It checks the complete board projection, card/control bounds, 44-pixel card hit areas, zero match scrolling, actual touchscreen taps and Chromium touch dragging, pause/resume, and landscape replay controls. The renderer's resize observer must finish updating the canvas before projection assertions. WebKit checks run on the desktop WebKit build with an emulated mobile viewport; a physical iOS or Android device has not been used for these automated checks.

Native asset tests validate 18 animation families, all 16,381 frame references across 915 clips, native FPS, nine directions, multipart geometry, color ranges and exact source/output hashes. The development-only `/tests/fixtures/animations.html` inspection page shows both teams for every troop with walk/idle/attack and facing controls. It is not an entry in the production build.

The initial October 22, 2026 checkpoint passed 21 simulation/persistence/asset tests and four desktop/phone browser tests. The native animation and phone upgrade adds four animation timing tests, complete source-geometry coverage and the responsive touch suite. Screenshots in `docs/screenshots/` record the visible checkpoints.

For manual playtesting, run `npm run dev`, start a battle, build a tank/support push in one lane, defend the other lane and use spells on swarms. Verify troop targeting, air counters, placement previews and the timer. Use keys 1–4 to select a card; Escape cancels a selection or pauses; Space pauses. Touch supports card selection and dragging onto the arena.

The diagnostics object `window.__arena` is read-only and reports current screen, elapsed battle time, selected slot, resources, troop/action counts, render draw calls, loaded animation families and recent frame rate. Its `project(x,y)` function exposes coordinate projection for browser tests without allowing simulation mutation.

The responsive/native-animation checkpoint passes 25 unit/asset tests and eight browser checks (plus one intentionally skipped desktop-only touch case), including both phone suites. Type checking, production build, and offline reload/battle startup also pass. The offline check covers the new native assets; removal of the duplicate first-battle instructional toast was checked in the final phone suite.

The combat/native-effects checkpoint passes 43 unit/asset/persistence checks and the same eight browser checks. New coverage includes delayed melee damage and attack intervals, target interception and building pulls, windup cancellation after movement/death/stun, Prince charge reset, homing shots after the attacker dies, ballistic bomb misses, dead-target handling, Fireball distance/knockback/immunity, three-wave Arrows, a frozen legacy replay and a complete current-rules replay. Both replay versions persist through profile reload. Effects and combat source hashes are verified, and browser/offline checks require all 18 native effect exports to load.

The development-only `/tests/fixtures/effects.html` displays every selected projectile orientation and sampled effect frames. `/tests/fixtures/combat.html` uses the real arena renderer and simulation with four reproducible scenarios and 0.1-second stepping: spell volleys, ranged attacks, Tesla/Zap and melee timing. The spell volley, bomb, arrow/spear orientations and electrical endpoints were visually inspected in these fixtures. `docs/screenshots/native-projectiles.png` records the Fireball/Arrows checkpoint.

The deployment checkpoint retains 43 passing unit/asset/persistence checks and expands browser coverage to 11 passing checks (plus the intentional desktop touch skip). The new test runs in desktop Chromium and phone Chromium/WebKit. It verifies complete native formation counts, invalid-territory feedback, rejected commands, dragging an already selected card, successful deployment, and feedback changing as elixir regenerates. Screenshot review caught and corrected labels/card portraits obscuring the preview. `docs/screenshots/phone-deployment.png` shows the full 15-Skeleton preview on a phone viewport. Backgrounding or pausing clears any active pointer drag.
