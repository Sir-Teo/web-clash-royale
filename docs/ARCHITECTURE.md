# Architecture

The game is a static Vite app. No server, official API, game account or secret is used.

## Battle simulation

`src/game/engine.ts` advances at a fixed 30 Hz. World coordinates span 18 × 32 tiles, with the blue player at the bottom. The river divides the battlefield at y=16. Ground units route through x=4 or x=14; flying units and the Hog Rider can cross directly.

Each player has an eight-card deck, a four-card hand, a four-card queue, capped elixir and crowns. Commands validate elixir and placement before mutating the hand or creating entities. Units acquire legal targets, move, attack and create projectiles. Spell and projectile damage resolve on impact. Buildings decay; the Witch summons skeletons; Prince charges; Balloon has death damage. The King Tower activates when damaged or after losing a Princess Tower.

AI uses the same command and resource path as the player. It scores affordable cards against visible threats, defends air with appropriate cards, and starts pushes when it has enough elixir. Training delays decisions. It does not receive extra elixir or deploy into illegal territory.

An initial seeded shuffle plus timestamped commands makes battles replayable. Replays disable AI decisions and consume the recorded commands. Particle randomness stays outside the simulation. Unit tests compare full entity, player and projectile state between a live run and its replay.

## Rendering

`src/render/arena.ts` projects the board with an orthographic Three.js camera. Static opaque geometry is batched by material. Animated source sprites share atlas textures and materials while each unit updates its own UV geometry. Camera-facing tower and scenery artwork keeps the original perspective. Locally constructed models remain available as asset-loading fallbacks.

Rendering interpolates positions independently of simulation steps. Health labels use the camera projection. Pointer coordinates are raycast onto the arena floor and passed to the same placement validator as AI commands. Preview ghosts use that validator, too.

## Interface and persistence

`src/main.ts` owns lobby, deck editing, battle controls, results and replay views. Card hand elements update only after the hand changes. Health, timer and elixir update at about 10 Hz. Simulation automatically pauses when the page is hidden. Modal dialogs pause a live match and resume when dismissed.

`src/game/profile.ts` validates versioned localStorage data and recovers from corrupt or unavailable storage. It retains three decks, results for ten matches, trophy/gold counters, audio preferences and four chest slots. Card levels are normalized to level 11; progression does not alter battle stats.

## Current boundaries

- AI battles only; online multiplayer and account synchronization are not implemented.
- 24 curated cards; evolutions, champions, equipment and the full live roster are not implemented.
- Historical art and curated normalized stats; no claim of current balance parity.
- Local browser progress only; clearing browser storage removes it.
- The surrounding diorama, some placement/pathing details and effects are approximations.
