# Clash Royale · Browser Arena

A private, independent browser fan game for Sir-Teo. Built with TypeScript, Three.js and Vite. AI battles work offline. Friendly two-player battles connect directly between browsers; the default build is front end only.

Build an eight-card deck from 61 cards, deploy troops and spells in a real-time arena battle, and take down the opposing King Tower. Includes three battle modes, complete native troop animations and projectile artwork, Goblin Stadium scenery reconstructed from archived exports and placements, audio, local progression, victory chests and match replays.

Combat includes cancellable attack windups, defensive building pulls, homing shots, ballistic bombs, Fireball travel and knockback, three-wave Arrows and Zap charge resets. Cannon uses its native aiming frames; Tesla hides underground, rises to attack and retracts when idle. Princess Towers use their dedicated native character animations. The King plays its original wake-up sequence and waits 3.3 seconds before aiming and attacking. Existing version-1 through version-4 replays retain their original rules; new matches record version-5 combat.

Princess Towers preserve the original base and foreground battlements, with the animated character placed between them using her authored origin and the archived attachment height.

Play against AI or challenge a friend over Wi-Fi or compatible remote networks. Exchange an invite and reply to connect the browsers directly, then use ready checks, emotes and both players’ replays. The full live card roster and current balance parity are not implemented. See [multiplayer setup](docs/MULTIPLAYER.md) for direct Wi-Fi play and static hosting.

The four original King emotes use complete native expressions and speech-bubble animations, with 16 voice variations. Six original quick-chat phrases use their native text bubbles, wooden selector and archived chat font. Each player has an independent bubble, a host-enforced cooldown and a persistent local mute option. The selector works with touch, mouse and keyboard; reduced motion uses still artwork.

Fireball impacts use the original layered smoke, glowing fragments, sparks, flames and lingering scorch effect. Native additive and screen blending keep fire and lightning bright, and particle motion follows the archived client’s linear deceleration and gravity integration. Sparks, fire, smoke and elixir splashes retain source tail delays and stretch their native artwork between projected motion endpoints; pause and replay seeking preserve their poses.

Zap impacts use the archived bolt, electricity, smoke, sparks and ground glow composition. Arrows fly as 15 visible sprites across three waves and leave 15 native ground marks. Their source artwork and particle timing work in solo play, replays and browser-to-browser matches on desktop and phone.

Freeze costs four elixir and holds enemies within its three-tile circle for four seconds, including troops that enter later and hidden Teslas. Its original portrait, cast sound, snow particles and blue/red ground artwork work in solo play, replays and browser-to-browser matches. Frozen troops, buildings and towers use the archived icy color animation, also shared by Zap.

Poison costs four elixir and damages enemies across an eight-second, 3.5-tile area. Its damage buff lingers briefly after a troop leaves, while buried Teslas remain immune. It uses the archived portrait, cast and impact cues, rising skull particles, team-colored ground rings and a 37-frame green color filter for troops, buildings and towers. Solo play, direct two-player matches and replays share the same fixed-step area rules.

Rage costs two elixir and boosts friendly troops' movement, attack and summoning speeds by 35% in a five-tile area. Its six-second source area reapplies the buff to troops entering later; the brief remaining buff cannot outlive the area. It uses the original portrait, purple ground rings, sparkles, impact sound, 50-frame troop color filter and 25% higher troop-sound pitch. The same fixed-step rules run in solo play, direct matches and replays.

Rocket costs six elixir and flies at its archived speed before a two-tile explosion damages ground and air troops, knocks surviving troops back and deals 40% damage to Crown Towers. Its original portrait, missile, smoke/spark/glow trail, eight-part impact, sound and screen shake play in solo, direct matches and replays. The 700-point archived damage uses the roster's Fireball level-11 conversion; the missile's 3D orientation remains a visual approximation.

Lightning costs six elixir and strikes the three highest-health enemies inside a 3.5-tile area at separate source-paced intervals. Each bolt damages and briefly stuns one target, with reduced Crown Tower damage. Its archived portrait, sky bolt, sparks, smoke, debris, audio and shake work in solo play, direct two-player matches and replays. Damage uses the roster's Fireball level-11 conversion; selecting a distinct target per pulse is the browser rules interpretation.

The Log costs two elixir and launches from your side before rolling through enemy ground units. Its archived Legendary portrait, two projectile stages, rolling trail, hit and breakup effects, and native audio accompany source-paced travel, one hit per target, knockback and reduced Crown Tower damage.

Tornado costs three elixir and pulls enemy ground and air troops toward the center of a 5.5-tile area while dealing small periodic damage. Its archived portrait, 390-frame team rings, 27-frame animated whirl, rocks, clouds, glow and sound work in solo play, direct matches and replays. Buildings are unaffected.

Goblin Barrel costs three elixir and flies across the arena before its native wooden burst releases exactly three Goblins. The archived 194-frame projectile, shadow, five-part landing effect and sounds work in solo play, direct matches and replays.

Graveyard costs five elixir and summons Skeletons every half second inside a large ten-second area. Its original Legendary portrait, team-colored ground/radius animation, mist, embers, burial holes, Skeleton arrival and sound work in solo play, direct matches and replays.

Clone costs three elixir and copies friendly ground and air troops inside a short-lived area. The one-hitpoint copies carry the original troop art with the archived animated hologram colors. Its Epic portrait, team radius, green light shaft, sparkles and sound work in solo play, direct matches and replays.

Musketeer and Cannon shots share the archived cannon impact; Bomber, Baby Dragon and Wizard projectiles use their own native sparks, smoke, flame and debris compositions. These hit effects stay separate from each troop's death effect.

Destroyed towers leave native rubble for the rest of the battle. Their collapse uses original fire, smoke, flying plank and wall-fragment artwork. Debris pauses with the match and finishes settling after victory; replay seeking reconstructs the correct ruins.

Earned crowns spin out of destroyed towers and fly to the matching score counter. A King Tower awards the remaining crowns to reach three. The flights follow pause and replay speed, adapt when a phone rotates, and finish before the result panel appears.

Finished matches play the original “Match Over!” animation and red/blue score panels, including separate old, empty and newly earned crown states. Replay seeking holds a still final score, and reduced motion skips the animated entrance. The ending fits portrait and landscape phones and freezes while the browser is backgrounded.

Tower outcomes resolve after all impacts in the current simulation step. Both Kings falling together produces a draw; equal Princess Tower trades can continue into overtime. A destroyed King collapses its remaining Princess Towers, and rewards never exceed three battle crowns per side.

Battle countdowns and overtime notices use the original font, authored animation frames, colors and elixir artwork. Native countdown voices and horn cues follow the match; replay seeking restores the correct notice without playing skipped sounds. Pausing, muting or backgrounding stops active sound effects.

Battles open with the original animated arena title, crossed swords, red/blue player ribbons and FIGHT lettering. Combat, AI and elixir wait for the intro's authored action frame. The opening pauses with the game, fits long player names, adapts to phone rotation and plays when a replay restarts; seeking skips it.

All 61 cards use original unframed portraits with native hand/deck frames, cost drops and text. Mirror repeats your previous card for one extra elixir; its hand and next-card costs update with the copied card. Minion Horde and Three Musketeers deploy six Minions and three Musketeers; Goblin Gang sends three melee Goblins ahead of three Spear Goblins; Barbarians deploy four original animated melee fighters; Elite Barbarians deploy two faster original fighters from a six-elixir card; Ice Spirit fires one native icy splash projectile, freezing ground and air enemies for 1.5 seconds before vanishing; Fire Spirits deploy three fast one-use attackers, each launching an original fiery ground-and-air splash projectile; Royal Giant fires an original large cannonball at buildings; Mega Minion flies and attacks ground or air with its native shot; Dart Goblin fires rapid darts with their original trail and hit effects; Ice Wizard’s icy splash slows ground and air targets for two seconds with its native cold filter; Princess fires a long-range five-arrow volley whose center arrow deals splash damage; Inferno Dragon locks onto a ground or air target with a beam that ramps through three damage stages; Electro Wizard Zaps nearby enemies on arrival and briefly stuns two targets with each attack; Miner tunnels to the enemy half and emerges behind defenses with reduced Crown Tower damage; Bowler rolls a boulder through ground troops and pushes survivors along its path; Dark Prince charges with a ground-splash mace and sheds his native shielded armor when the shield breaks; Battle Ram ignores defenders as it charges a building and releases two Barbarians when it breaks; Executioner throws one axe through ground and air defenders, then catches it after a second hit on the return path; Sparky charges a ground-only cannon that splashes and pushes back defenders, with Zap resetting its charge; Lumberjack drops a falling Rage bottle on death, leaving a 7.5-second friendly buff area; Bats deploy five small flying attackers with their original looping motion; Night Witch summons Bats every five seconds and releases four more when defeated; Bandit dashes from four to six tiles, becomes untouchable during travel and delivers a heavy landing hit; Golem takes three seconds to deploy, ignores troop distractions, explodes against ground and air defenders and splits into two independently exploding Golemites; Lava Hound flies at its source height, fires homing coal from its original muzzle height, and releases six Lava Pups that fly at their source height when defeated. Selected cards show the original white outline, and newly drawn cards play the source reveal animation. The same artwork appears in the deck editor, details, next-card preview and drag controls; phone touch targets remain at least 44 pixels.

Flying troops, drag previews, death effects, projectile origins, and Inferno Dragon's beam use the individual heights and muzzle offsets from the archived character data. Their shadows and team markers stay on the arena floor while the troops bob overhead.

The match timer and vertical crown counters use the original HUD artwork and type. Overtime transitions into its native red panel, and each team's crown icon plays the source bounce when awarded crowns. Portrait and landscape use their separate archived layouts; crown flights land on the actual counter artwork.

Troops and towers use the original health bars, level badges, crown icons and hitpoint typography. Small, medium and large bars follow the archived character profiles; the King’s health display opens with its activation. Damage, pause and replay seeking preserve the correct fill and animation frame, including on phone rotations.

The elixir HUD uses native bar, drop, divider and card-cost artwork, with the original gain, spend, full-bar and regeneration animations. Narrow landscape layouts shorten the bar while keeping its number readable. All feedback follows the simulation clock and clears correctly when seeking a replay.

Troop deaths use source-specific elixir splashes, smoke, dust and ground marks. Knights leave their original sword behind, Giants have a larger burst, Skeletons have smaller effects, and Balloons release airborne clouds. Native particle geometry is batched on the GPU to keep large swarms practical on phone-sized screens.

Combat sound follows separate attack windups, projectile launches, impacts and spell casts. Native weapon sounds and voice variations use their archived delay, pitch and volume ranges. Interrupted attacks discard their pending windup cues; projectiles retain their sound even after the shooter dies. Audio follows replay speed, pause and both players' direct connection. Battle music switches among the pinned two-minute, last-minute, final-30-second and sudden-death tracks as the match clock advances; replay seeking resumes the matching passage. Music and sound-effect switches work independently.

Deployments use original troop-specific dust, shadows and rock bursts, including separate effects at each Archer’s spawn position. Source delays and late peer snapshots keep the burst at the birth location. Deployments also use each troop or building's own cues, including the Musketeer's delayed reload and troop voice variations. The Witch plays her original skeleton-summoning cue. Tesla plays its native opening and closing sounds as it rises and retracts. The Balloon death bomb uses its team-colored native drop animation, original sound cues, fire, smoke, debris and a fading ground mark. Fireball, Zap, Balloon impacts and tower destruction move the arena using the source shake durations and a decaying camera offset; controls remain fixed, pause freezes the frame, and reduced motion disables the movement. Swarm voices obey their source limits, and delayed voices stop when their owner dies.

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

`npm run assets:death-audio` imports the corresponding native sound mappings and eight pinned audio files, preserving nested effects, team variants, volume/pitch ranges and delays.

`npm run assets:combat-audio` imports 62 troop/tower/spell sound profiles, 214 groups and 243 pinned audio files from the retained logic, effects and sound tables. Card sources come from the native portrait bindings. Source and output hashes are retained in the combat-audio manifest.

`npm run assets:ui` imports five native battle announcement timelines, their text styles, font, elixir icon and sound mappings. `/tests/fixtures/timing.html` provides precise countdown/overtime inspection and is excluded from production.

`npm run assets:intro` imports the complete standard/training battle openings and derives their action-frame timing. `/tests/fixtures/intro.html` inspects source frames, player-name fitting and the transition into combat.

`npm run assets:elixir` imports eight native elixir HUD clips and their source geometry. `/tests/fixtures/elixir.html` provides amount, selected-cost, spending, regeneration and frame-step controls for visual inspection.

`npm run assets:cards` imports native card layers and all 58 source portraits. `/tests/fixtures/cards.html` provides the full gallery, selection states and a frame-stepped hand reveal.

`npm run assets:freeze` pins Freeze's archived cost, radius, duration and hidden-target rule. `npm run assets:destruction`, `npm run assets:effects` and `npm run assets:combat-audio` regenerate its original particles, ground/radius clips and cast sound. `npm run assets:cold-filter` imports the original character tint shared by Freeze and Zap.

`npm run assets:poison` pins Poison's cost, radius, duration, tick interval, damage buff and tower multiplier. `npm run assets:poison-filter` imports its original 37-frame troop color and squash timeline. The shared card, effect and audio imports include its portrait, skull particles, ground clips and cues.

`npm run assets:rage` pins Rage's cost, radius, duration, buff interval and three speed multipliers. `npm run assets:rage-filter` imports the original 50-frame purple troop color timeline. The shared card, effect and audio imports include its portrait, sparkles, ground clips and sound.

`npm run assets:rocket` pins Rocket's cost, radius, speed, damage, knockback and Crown Tower multiplier. The shared card, effect, impact and audio imports include its source portrait, 60-frame projectile, explosion and cues.

`npm run assets:lightning` pins the archived cost, radius, 1.5-second area, 460-ms pulse, highest-health targeting, projectile damage and half-second stun. Shared imports provide its original portrait, nine-part impact and sound.

`npm run assets:log` pins the archived launch and rolling projectile rules. Shared imports provide its original portrait, blue/red rolling art, shadow, dust, wooden breakup and sound.

`npm run assets:tornado` pins its archived area, buff, attraction and damage rules. Shared imports provide its original portrait, animated whirl, rings, particles and sound.

`npm run assets:goblin-barrel` pins its archived projectile, travel speed, landing radius and three-Goblin spawn. Shared imports provide the original portrait, flight animation, shadow, impact and sound.

`npm run assets:graveyard` pins its archived ten-second area, 1.5-second initial delay, half-second Skeleton cadence and deploy time. Shared imports provide the original portrait, team ground/radius clips, spawn effects and sound.

`npm run assets:clone` pins the archived short area, own-troop targets and hologram binding; `npm run assets:clone-filter` retains both native color timelines. Shared imports provide the portrait, ground/radius effects, sparkles and sound.

`npm run assets:golem` pins both source character profiles, the eight-elixir card, building targeting, deployment delay, death blasts and two-Golemite split. Shared imports provide the original portrait, 54 directional clips per character, blue/red art, dust and rock effects, death audio and health displays. Golem's four authored firefly emissions use their original blue/red animated particles and follow the unit through replay and peer snapshots; the client archive does not expose the loop period, so the browser repeats the 0/3/9/12-second pattern every 15 seconds. `/tests/fixtures/combat.html` inspects the animated split.

`npm run assets:lava-hound` pins the seven-elixir Legendary card, flying Hound and Pup profiles, both 45-point homing coal projectiles and six-Pup death release. Shared imports provide the original portrait, 54 Hound and 27 Pup directional clips, projectile trails and hit particles, effects, sound mappings and health displays. The archived Hound death sound group has no audio file; Pups retain generic death audio. `/tests/fixtures/combat.html` inspects the flight and split.

`npm run assets:health` imports 12 native health displays and ten fill timelines. `/tests/fixtures/health.html` inspects the original artwork; `/tests/fixtures/health-arena.html` exercises damage, King activation, pause, death and renderer rebuilding in the arena.

`npm run assets:hud` imports six native timer/crown clips and both responsive crown compositions. `/tests/fixtures/hud.html` provides precise timer, score, animation-frame and source-layout inspection.

`npm run assets:ending` imports five native match-ending and score timelines. `/tests/fixtures/ending.html` inspects exact frames, names, crown awards and still final scores.

`npm run assets:emotes` imports 17 native reaction/control clips, six quick-chat phrases, the chat font and four original voice groups. `/tests/fixtures/emotes.html` provides both player bubbles, expression/phrase selection, frame stepping, voice playback and mute controls.

## Phone play

Open the Vite **Network** URL on a phone connected to the same Wi-Fi as the development computer. `localhost` on a phone refers to the phone itself. For a friendly match, use **Share invite** or **Share reply** when available, or the **Copy** buttons on an HTTP Wi-Fi address; a game opened at `localhost` shares a code that the other phone can paste after opening the Network URL. Portrait battles fill the available browser height; rotating into landscape moves the hand alongside the arena. Safe-area padding keeps controls away from display cutouts and the home indicator. Tap a card and then the arena, or drag a card onto the battlefield. Pause and settings use 44-pixel touch targets. AI battles pause when the browser goes into the background. Direct friendly battles pause when either player switches apps. Keep both tabs open; a reload requires a new invite.

## Static hosting

The current game is live at https://sir-teo-clash.web.app/. It serves the front-end-only build from a dedicated Firebase Hosting site; the match still connects browser to browser. To publish the current checkout again, install the Firebase CLI and run `npm run deploy:hosting`. The command builds `dist/` with root-relative assets and publishes only that directory to the `sir-teo-clash` site in project `sincere-hybrid-203601`. Source, tests and reference files remain in the private repository.

GitHub Pages is also configured to deploy on every push to `main` through `.github/workflows/pages.yml` at https://teozeng.dev/web-clash-royale/. As of October 23, 2026, GitHub Actions rejects its jobs before the first step because of an account billing or spending-limit issue ([affected Pages run](https://github.com/Sir-Teo/web-clash-royale/actions/runs/40034244242)); that URL has an older build. Once the account issue is resolved, Pages can build the current `main` branch with `VITE_BASE_PATH=/web-clash-royale/`.

## Controls

- Click a hand card, then click the arena, or drag the card into position.
- Placement previews show the complete troop formation in native artwork, with live elixir and territory feedback.
- Keys **1–4** select a card. **Escape** cancels a selection or pauses; **Space** pauses.
- During a replay, the speed button cycles through 1×, 2×, 4×, 0.5× and 0.25×.
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
