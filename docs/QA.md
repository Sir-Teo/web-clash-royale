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

Native asset tests validate 19 animation families (18 troop families and Tower Princess), all 18,181 frame references across 969 clips, native FPS, nine directions, multipart geometry, color ranges and exact source/output hashes. The development-only `/tests/fixtures/animations.html` inspection page shows both teams for every troop with walk/idle/attack and facing controls. It is not an entry in the production build.

The initial October 22, 2026 checkpoint passed 21 simulation/persistence/asset tests and four desktop/phone browser tests. The native animation and phone upgrade adds four animation timing tests, complete source-geometry coverage and the responsive touch suite. Screenshots in `docs/screenshots/` record the visible checkpoints.

For manual playtesting, run `npm run dev`, start a battle, build a tank/support push in one lane, defend the other lane and use spells on swarms. Verify troop targeting, air counters, placement previews and the timer. Use keys 1–4 to select a card; Escape cancels a selection or pauses; Space pauses. Touch supports card selection and dragging onto the arena.

The diagnostics object `window.__arena` is read-only and reports current screen, elapsed battle time, selected slot, resources, troop/action counts, render draw calls, loaded animation families and recent frame rate. Its `project(x,y)` function exposes coordinate projection for browser tests without allowing simulation mutation.

The responsive/native-animation checkpoint passes 25 unit/asset tests and eight browser checks (plus one intentionally skipped desktop-only touch case), including both phone suites. Type checking, production build, and offline reload/battle startup also pass. The offline check covers the new native assets; removal of the duplicate first-battle instructional toast was checked in the final phone suite.

The combat/native-effects checkpoint passes 43 unit/asset/persistence checks and the same eight browser checks. New coverage includes delayed melee damage and attack intervals, target interception and building pulls, windup cancellation after movement/death/stun, Prince charge reset, homing shots after the attacker dies, ballistic bomb misses, dead-target handling, Fireball distance/knockback/immunity, three-wave Arrows, a frozen legacy replay and a complete current-rules replay. Both replay versions persist through profile reload. Effects and combat source hashes are verified, and browser/offline checks require all 18 native effect exports to load.

The development-only `/tests/fixtures/effects.html` displays every selected projectile orientation and sampled effect frames. `/tests/fixtures/combat.html` uses the real arena renderer and simulation with seven reproducible scenarios and 0.1-second stepping: spell volleys, ranged attacks, Tesla/Zap and melee timing. The spell volley, bomb, arrow/spear orientations and electrical endpoints were visually inspected in these fixtures. `docs/screenshots/native-projectiles.png` records the Fireball/Arrows checkpoint.

The deployment checkpoint retains 43 passing unit/asset/persistence checks and expands browser coverage to 11 passing checks (plus the intentional desktop touch skip). The new test runs in desktop Chromium and phone Chromium/WebKit. It verifies complete native formation counts, invalid-territory feedback, rejected commands, dragging an already selected card, successful deployment, and feedback changing as elixir regenerates. Screenshot review caught and corrected labels/card portraits obscuring the preview. `docs/screenshots/phone-deployment.png` shows the full 15-Skeleton preview on a phone viewport. Backgrounding or pausing clears any active pointer drag.

The defensive-building checkpoint passes 53 unit/asset/persistence checks and 14 browser checks (plus the intentional desktop touch skip). Tesla coverage includes hidden damage protection, lifetime decay, ground/air emergence, targeting changes, partial-transition reversal, stun, and a complete current-rules replay. Frozen version-1 and version-2 matches still reproduce their complete saved states. Building asset tests verify both teams, 19 Cannon aim frames, 39 Tesla timeline frames, authored labels and source/output hashes. A new arena fixture test drives both Teslas through hidden, rising, exposed and sinking states in all three browser projects. `docs/screenshots/native-buildings.png` records the inspected native building scene.

Type checking and the production build pass with 287 cached files. The isolated offline check loads all 18 troop families, 18 effect exports and both native buildings after disabling the network, then starts a battle. An initial offline run concurrent with the browser suite timed out on page load; the isolated rerun passed.

The background/render-timing check emulates the browser visibility event in headless Chromium and WebKit. It verifies that live battles and replays pause, rendered-frame counts and both clocks remain unchanged while hidden, and returning restarts rendering without automatically resuming combat. Replay controls expose the correct Pause, Resume or Restart label. This is automated lifecycle coverage; physical phone app-switching and battery measurements remain untested.

A paused-projectile regression test holds a Fireball at 0.1 seconds and checks that its trail particle count stops changing. It reproduced the bug before the fix (the count grew from 2 to 40 while simulation time stayed frozen). The combat inspection page now advances its visual delta only when simulation time advances, including manual steps.

The final pause/particle checkpoint passes 53 unit/asset tests, type checking, production build and 17 browser checks (plus the intentional desktop touch skip). The paused-Fireball regression passes on desktop Chromium and both phone browser projects.

King activation coverage checks the sourced 3.3-second delay, the subsequent first-shot windup, activation after Princess Tower loss, repeated damage without restarting, and destruction during wake-up. A frozen v3 match joins the v1/v2 snapshots, and all four replay versions survive profile reload. Asset coverage verifies both 98-frame wake sequences, independent idle loops, 36 cannon angles per team, every derived frame and its source/output hashes. The development building fixture includes enlarged cannon samples to verify the half-turn mapping.

The native King checkpoint passes 58 unit/asset/persistence checks and 20 browser checks (plus the intentional desktop touch skip). Type checking, the production build and an isolated offline reload/battle start pass with all three native building families. The King wake and active aiming states were inspected in the arena and saved as `docs/screenshots/king-wake.png` and `king-active.png`.

Tower destruction unit checks cover source counts/delays, seeded visual variation, finite bounded trajectories, paused poses, post-victory expiry, owned-material cleanup and rubble reconstructed from current tower state. Client source/output hashes and all 31 native effect exports are validated. The browser scenario destroys Princess Towers, holds debris paused, advances until it settles, rebuilds the renderer, destroys a King, lets the final particles expire while battle time remains frozen, and resets to a clean arena.

The destruction checkpoint passes 61 unit/asset/persistence checks, type checking, the production build and 23 browser checks (plus the intentional desktop touch skip). Native collapse and persistent ruins were inspected and captured in `native-tower-collapse.png`, `native-tower-ruins.png` and `phone-tower-collapse.png` under `docs/screenshots/`. The phone pause assertion waits for the final manual simulation step to render before taking its baseline.

The isolated production offline check also passes with all 18 troop families, 31 effect exports and three building families, followed by battle startup with the network disabled. The generated cache contains 289 files.

The standing-building terrain correction was inspected against the original King artwork: doors, ramps, ladders and lower stonework now remain visible. `complete-tower-bases.png` and `phone-complete-towers.png` record the corrected arena and real phone battle layout. All 61 unit checks, type checking and the production build pass; the focused building/King/phone suite passes eight checks plus the intentional desktop touch skip.

The Tower Princess import adds both teams’ nine-direction tower-specific clips, with 40 attack frames and 30 idle/run frames at 24 FPS. The importer excludes the separate deployable Princess exports in the same source. Asset tests now verify metadata hashes for every animation family as well as geometry/output hashes. Browser game checks require all four towers to use the dedicated Princess asset; the combat fixture includes stationary targets for inspecting their aim and attacks.

The dedicated Princess checkpoint passes all 61 unit/asset/persistence checks, type checking and the production build. The focused deck/deployment/King/phone suite passes 11 checks plus the intentional desktop touch skip. An isolated offline reload loads all 19 animation families, four native tower characters, 31 effect exports and three building families, then starts a battle with the network disabled. The production cache contains 291 files. `native-tower-princess.png` and `phone-native-princess.png` capture the inspected result.
