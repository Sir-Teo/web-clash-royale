# Architecture

The game is a static Vite app. No server, official API, game account or secret is used.

## Battle simulation

`src/game/engine.ts` advances at a fixed 30 Hz. World coordinates span 18 × 32 tiles, with the blue player at the bottom. The river divides the battlefield at y=16. Ground units route through x=4 or x=14; flying units and the Hog Rider can cross directly.

Each player has an eight-card deck, a four-card hand, a four-card queue, capped elixir and crowns. Commands validate elixir and placement before mutating the hand or creating entities. Units acquire legal targets, move, attack and create projectiles. Spell and projectile damage resolve on impact. Buildings decay; the Witch summons skeletons; Prince charges; Balloon has death damage. The King Tower activates when damaged or after losing a Princess Tower.

AI uses the same command and resource path as the player. It scores affordable cards against visible threats, defends air with appropriate cards, and starts pushes when it has enough elixir. Training delays decisions. It does not receive extra elixir or deploy into illegal territory.

An initial seeded shuffle plus timestamped commands makes battles replayable. Replays disable AI decisions and consume the recorded commands. Particle randomness stays outside the simulation. Unit tests compare full entity, player and projectile state between a live run and its replay.

New battles use rules version 4, extending version-2 combat with Tesla concealment and delayed King activation. Attack animations begin a pending windup; melee damage or projectile launch occurs when it completes. Target death, leaving attack range, stun and movable-unit knockback cancel that pending hit. Troops reconsider a distant tower destination when a defender or building enters sight, while retaining an engaged target. Projectile speed and homing are per-unit; Bomber throws retain their original landing position. Fireball travel time depends on distance and its radial knockback respects heavy-unit immunity. Arrows deliver three equal waves 0.2 seconds apart. Zap interrupts windups and Prince charge.

The original combat loop is frozen in `updateLegacyCombat()` for version-1 replay compatibility. A captured v1 match is compared against its original complete saved state. A captured version-2 match also retains its original complete state, including always-exposed Teslas. A captured version-3 match preserves immediate King activation. Current replay tests include entire version-4 matches, pending attacks, projectile flight, Tesla exposure and King wake state. Profile history accepts all four versions and rejects unknown future versions.

`scripts/import-combat.mjs` derives the compact `src/game/combat-data.json` table from pinned historical CSVs. Sight ranges, homing flags and knockback immunity are direct source fields. First-hit timing (`HitSpeed - LoadTime`) and the speed-to-tile conversion are reconstruction interpretations; damage, health and hit intervals remain this project's curated level-11 values. The implementation is deterministic, but is not a claim of exact original runtime behavior or current balance parity.

Tesla becomes untargetable and immune to damage while fully underground; lifetime decay continues. Ground units can pass over the closed hatch. Enemies within attack range trigger emergence, and departing enemies trigger an idle grace period followed by retraction. An exposed or partially exposed Tesla can take damage; stun freezes its transition. The 0.8-second rise, grace and retract intervals interpret the archived `UpTimeMs`/`HideTimeMs` values and native animation lengths. They are reconstruction choices, not measured original runtime behavior.

A King activates when it takes damage or loses a Princess Tower. Version-4 battles use the archived `KING_ACTIVATE_TIME_MS` value of 3,300 ms before starting its normal attack windup. Subsequent damage does not restart the wake sequence; stun overlaps the wake timer and still blocks attacks when present. Earlier replay versions keep immediate activation. `scripts/import-combat.mjs` derives this setting from the retained `globals.csv` alongside the combat profiles.

## Rendering

`src/render/arena.ts` projects the board with an orthographic Three.js camera. Static opaque geometry is batched by material. Animated source sprites share native textures, materials and lazily cached frame geometry. The importer preserves complete directional clips, child transforms and per-part color transforms. Sprites follow movement direction on bridges; attacks use full source sequences; Prince uses its separate charge animation and Balloon retains its multipart motion. Princess Tower archers animate with their tower attacks. Camera-facing tower and scenery artwork keeps the original perspective. Locally constructed models remain available as asset-loading fallbacks.

Rendering interpolates positions independently of simulation steps. Health labels use the camera projection. Pointer coordinates are raycast onto the arena floor and passed to the same placement validator as AI commands. Preview ghosts use that validator, too.

Deployment previews use the same `deploymentPositions()` formation as troop creation, including the complete 15-unit Skeleton Army and board-edge clamping. They share native animation geometry but own their translucent materials, keeping the actual troops opaque. Buildings use the loaded source artwork. Each lane's prohibited overlay follows its surviving Princess Tower, and the river stays blocked. Inline placement feedback combines territory and elixir checks, updates as elixir regenerates, and is announced as a polite status message. Dragged card portraits hide over the board so they do not cover the native formation. Pointer ownership prevents a second touch from changing an in-progress drag.

`src/render/effects.ts` reuses the native frame geometry and SC color-transform shader for 31 original effect exports. `src/render/projectiles.ts` draws source arrow, spear, cannonball, bomb and flame art along simulation flight positions, with trajectory-dependent billboard rotation and per-shot heights. Arrow waves are separate visible volleys. Tesla hit events retain the firing position so their authored beam joins the correct endpoints; Zap uses the original bolt and ground glow. Transient native effects follow a render effect clock that respects replay speed and pause and keeps advancing after victory so the final collapse settles. They share cached geometry/materials.

`src/render/buildings.ts` shares the native frame geometry and shader with troop sprites. Cannon chooses among 19 source aim angles per team and mirrors leftward shots. Tesla maps simulation exposure to the 39-frame source timeline using its authored deploy, idle, appear and hide labels. Its health bar follows the raised tower. The King uses its 98-frame activation timeline, separate 86/99-frame blue/red idle loops, and 36 half-turn cannon directions with leftward mirroring. Separate base, cannon and foreground meshes preserve source occlusion while allowing independent aiming. Wake frames follow the simulation countdown; replay seeking reconstructs the matching pose. Building previews share these assets; source textures and all frames are available offline.

Tower destruction is separate from combat state. `src/game/arena-layout.ts` supplies the same ordered six tower sites to the engine and renderer, preserving legacy IDs. Missing/dead towers produce the appropriate native rubble; rebuilding a replay renderer reconstructs ruins from current entities. Rubble is projected onto the arena floor with its authored screen proportions, avoiding billboard clipping below the floor.

`src/render/destruction.ts` uses the retained client compositions and six emitters: 78 source particles per tower, with native fire, wood, wall fragments and smoke. A separate seeded cosmetic RNG preserves variety without changing the simulation. Per-particle materials preserve the SC shader and own their fade opacity; shared textures and frame geometry survive cleanup. The 400-particle cap bounds simultaneous collapse cost. Analytic trajectories make motion independent of render frame rate; exponential drag, ground settling and world scaling are reconstruction choices. Reset/replay seeking clears transient particles. Finished matches stop producing projectile trails and allow the last impacts/debris to expire.

## Interface and persistence

`src/main.ts` owns lobby, deck editing, battle controls, results and replay views. During battles, a viewport-height flex layout gives the arena all remaining space after the header and hand; short landscape screens use a two-column arena/hand layout. Safe-area insets, dynamic viewport height and touch targets support phone use without scrolling the match. Card hand elements update only after the hand changes. Health, timer and elixir update at about 10 Hz. Battles and replays automatically pause when the page is hidden or enters page-cache suspension. The animation-frame loop is cancelled while hidden and restarted with a fresh timing baseline on return; the match remains paused until the player resumes. Lobby, paused and finished views render at 30 FPS, while active matches follow the display refresh rate. Troop animations and scenery use the match clock during battles/replays, so pause and replay speed affect them consistently. The FPS diagnostic reports frames actually rendered over a sampling interval. Modal dialogs pause a live match and resume when dismissed.

`src/game/profile.ts` validates versioned localStorage data and recovers from corrupt or unavailable storage. It retains three decks, results for ten matches, trophy/gold counters, audio preferences and four chest slots. Card levels are normalized to level 11; progression does not alter battle stats.

## Current boundaries

- AI battles only; online multiplayer and account synchronization are not implemented.
- 24 curated cards; evolutions, champions, equipment and the full live roster are not implemented.
- Historical art and curated normalized stats; no claim of current balance parity.
- Local browser progress only; clearing browser storage removes it.
- The surrounding diorama, some placement/pathing details and effects are approximations.
