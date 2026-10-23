# Clash Royale · Browser Arena

A private, independent browser fan game for Sir-Teo. Built with TypeScript, Three.js and Vite. AI battles work offline. Friendly two-player battles connect directly between browsers; the default build is front end only.

Build an eight-card deck from 24 cards, deploy troops and spells in a real-time arena battle, and take down the opposing King Tower. Includes three battle modes, complete native troop animations and projectile artwork, Goblin Stadium scenery reconstructed from archived exports and placements, audio, local progression, victory chests and match replays.

Combat includes cancellable attack windups, defensive building pulls, homing shots, ballistic bombs, Fireball travel and knockback, three-wave Arrows and Zap charge resets. Cannon uses its native aiming frames; Tesla hides underground, rises to attack and retracts when idle. Princess Towers use their dedicated native character animations. The King plays its original wake-up sequence and waits 3.3 seconds before aiming and attacking. Existing version-1 through version-4 replays retain their original rules; new matches record version-5 combat.

Princess Towers preserve the original base and foreground battlements, with the animated character placed between them using her authored origin and the archived attachment height.

Play against AI or challenge a friend over Wi-Fi or compatible remote networks. Exchange an invite and reply to connect the browsers directly, then use ready checks, emotes and both players’ replays. The full live card roster and current balance parity are not implemented. See [multiplayer setup](docs/MULTIPLAYER.md) for direct Wi-Fi play and static hosting.

The four original King emotes use complete native expressions and speech-bubble animations, with 16 voice variations. Six original quick-chat phrases use their native text bubbles, wooden selector and archived chat font. Each player has an independent bubble, a host-enforced cooldown and a persistent local mute option. The selector works with touch, mouse and keyboard; reduced motion uses still artwork.

Destroyed towers leave native rubble for the rest of the battle. Their collapse uses original fire, smoke, flying plank and wall-fragment artwork. Debris pauses with the match and finishes settling after victory; replay seeking reconstructs the correct ruins.

Earned crowns spin out of destroyed towers and fly to the matching score counter. A King Tower awards the remaining crowns to reach three. The flights follow pause and replay speed, adapt when a phone rotates, and finish before the result panel appears.

Finished matches play the original “Match Over!” animation and red/blue score panels, including separate old, empty and newly earned crown states. Replay seeking holds a still final score, and reduced motion skips the animated entrance. The ending fits portrait and landscape phones and freezes while the browser is backgrounded.

Tower outcomes resolve after all impacts in the current simulation step. Both Kings falling together produces a draw; equal Princess Tower trades can continue into overtime. A destroyed King collapses its remaining Princess Towers, and rewards never exceed three battle crowns per side.

Battle countdowns and overtime notices use the original font, authored animation frames, colors and elixir artwork. Native countdown voices and horn cues follow the match; replay seeking restores the correct notice without playing skipped sounds. Pausing, muting or backgrounding stops active sound effects.

Battles open with the original animated arena title, crossed swords, red/blue player ribbons and FIGHT lettering. Combat, AI and elixir wait for the intro's authored action frame. The opening pauses with the game, fits long player names, adapts to phone rotation and plays when a replay restarts; seeking skips it.

All 24 cards use original unframed portraits with native hand/deck frames, cost drops and text. Selected cards show the original white outline, and newly drawn cards play the source reveal animation. The same artwork appears in the deck editor, details, next-card preview and drag controls; phone touch targets remain at least 44 pixels.

The match timer and vertical crown counters use the original HUD artwork and type. Overtime transitions into its native red panel, and each team's crown icon plays the source bounce when awarded crowns. Portrait and landscape use their separate archived layouts; crown flights land on the actual counter artwork.

Troops and towers use the original health bars, level badges, crown icons and hitpoint typography. Small, medium and large bars follow the archived character profiles; the King’s health display opens with its activation. Damage, pause and replay seeking preserve the correct fill and animation frame, including on phone rotations.

The elixir HUD uses native bar, drop, divider and card-cost artwork, with the original gain, spend, full-bar and regeneration animations. Narrow landscape layouts shorten the bar while keeping its number readable. All feedback follows the simulation clock and clears correctly when seeking a replay.

Troop deaths use source-specific elixir splashes, smoke, dust and ground marks. Knights leave their original sword behind, Giants have a larger burst, Skeletons have smaller effects, and Balloons release airborne clouds. Native particle geometry is batched on the GPU to keep large swarms practical on phone-sized screens.

Combat sound follows separate attack windups, projectile launches, impacts and spell casts. Native weapon sounds and voice variations use their archived delay, pitch and volume ranges. Interrupted attacks discard their pending windup cues; projectiles retain their sound even after the shooter dies. Audio follows replay speed, pause and both players' direct connection.

Deployments use each troop or building's own cues, including the Musketeer's delayed reload and troop voice variations. The Witch plays her original skeleton-summoning cue. Swarm voices obey their source limits, and delayed voices stop when their owner dies.

## Development

```sh
npm ci
npm run dev
```

`npm run check` runs simulation and persistence tests, type checking and a production build. `npm run test:e2e` runs desktop Chromium and phone Chromium/WebKit browser tests (install both once with `npx playwright install chromium webkit`). Assets and fonts are bundled locally. The production build generates an offline cache; after its first complete load, the game can reload and start battles without a network connection.

To verify offline behavior, run `npm run preview -- --host 127.0.0.1 --port 5189 --strictPort` and then `npm run test:offline`.

`npm run assets` refreshes cards, renders and audio. `npm run assets:sprites` imports complete native animation sequences and lossless textures; `npm run assets:scenery` reconstructs tower and arena textures from the retained metadata. No asset generation is needed for normal development.

`npm run assets:combat` regenerates combat traits from retained historical CSVs. `npm run assets:effects` imports the original projectile and electrical-effect clips. `npm run assets:buildings` imports both teams’ Cannon, Tesla and layered King Tower timelines. Development inspection pages are available at `/tests/fixtures/animations.html`, `/tests/fixtures/effects.html`, `/tests/fixtures/buildings.html` and `/tests/fixtures/combat.html`; they are excluded from the production build.

`npm run assets:destruction` regenerates tower and troop death compositions from retained client/character tables and imports their native particle clips.

`npm run assets:death-audio` imports the corresponding native sound mappings and six pinned audio files, preserving nested effects, team variants, volume/pitch ranges and delays.

`npm run assets:combat-audio` imports 26 troop/tower/spell sound profiles, 87 groups and 107 pinned audio files from the retained logic, effects and sound tables. Card sources come from the native portrait bindings. Source and output hashes are retained in the combat-audio manifest.

`npm run assets:ui` imports five native battle announcement timelines, their text styles, font, elixir icon and sound mappings. `/tests/fixtures/timing.html` provides precise countdown/overtime inspection and is excluded from production.

`npm run assets:intro` imports the complete standard/training battle openings and derives their action-frame timing. `/tests/fixtures/intro.html` inspects source frames, player-name fitting and the transition into combat.

`npm run assets:elixir` imports eight native elixir HUD clips and their source geometry. `/tests/fixtures/elixir.html` provides amount, selected-cost, spending, regeneration and frame-step controls for visual inspection.

`npm run assets:cards` imports native card layers and all 24 source portraits. `/tests/fixtures/cards.html` provides the full gallery, selection states and a frame-stepped hand reveal.

`npm run assets:health` imports 12 native health displays and ten fill timelines. `/tests/fixtures/health.html` inspects the original artwork; `/tests/fixtures/health-arena.html` exercises damage, King activation, pause, death and renderer rebuilding in the arena.

`npm run assets:hud` imports six native timer/crown clips and both responsive crown compositions. `/tests/fixtures/hud.html` provides precise timer, score, animation-frame and source-layout inspection.

`npm run assets:ending` imports five native match-ending and score timelines. `/tests/fixtures/ending.html` inspects exact frames, names, crown awards and still final scores.

`npm run assets:emotes` imports 17 native reaction/control clips, six quick-chat phrases, the chat font and four original voice groups. `/tests/fixtures/emotes.html` provides both player bubbles, expression/phrase selection, frame stepping, voice playback and mute controls.

## Phone play

Open the Vite **Network** URL on a phone connected to the same Wi-Fi as the development computer. `localhost` on a phone refers to the phone itself. Portrait battles fill the available browser height; rotating into landscape moves the hand alongside the arena. Safe-area padding keeps controls away from display cutouts and the home indicator. Tap a card and then the arena, or drag a card onto the battlefield. Pause and settings use 44-pixel touch targets. AI battles pause when the browser goes into the background. Direct friendly battles pause when either player switches apps. Keep both tabs open; a reload requires a new invite.

## Controls

- Click a hand card, then click the arena, or drag the card into position.
- Placement previews show the complete troop formation in native artwork, with live elixir and territory feedback.
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
