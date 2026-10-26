# Project line integration

This checkout integrates local `3a488e0` (39 commits after the common base `3126ee6`) with archived-roster `06bcda90fdd38c058729df2b51bbece9c9354151` (242 commits). Work takes place on `codex/integrate-project-lines`; the original local `main` checkout is preserved. No push or deployment is part of this integration.

## Behavior retained

| Area                     | Integrated behavior                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cards and source rules   | All 74 archived 1.8.1 playable cards, native assets, source-derived stats, collision radii, flying heights, complex unit/spell mechanics and origin replay versions 1–18. New matches record origin version 18.                                                                                                                                                                                                                                                                                                       |
| Defensive AI             | Local damage/area-spell planning, pending blast accounting, push/swarm pressure, affordable fallback defense, legal building lures and moving melee interception, adapted to current card stats and radii. New targeting guards respect troop-only Rage, building-only attacks, invulnerable Bandit dashes, clone armies and shield damage packets. Spawned Lava Pups/Golemites retain explicit tactical value. Additional spells retain the existing origin heuristic rather than claiming specialized optimization. |
| Solo variety             | Seventeen curated opponents cover all 74 cards, with repeat avoidance and deterministic deck selection outside the gameplay RNG. Training retains Royal Trainer. Every deck has air defense and at most three spells/buildings.                                                                                                                                                                                                                                                                                       |
| Deck collection          | Search, type/cost filters, sorting, card inspection, deck codes, saved deck ordering and visit-scoped Undo/Redo with keyboard controls and protection from stale history.                                                                                                                                                                                                                                                                                                                                             |
| Accessibility            | Native keyboard activation, battle aiming, dialog focus retention/trapping, pause controls and replay skip/seek controls.                                                                                                                                                                                                                                                                                                                                                                                             |
| Saved matches            | Playable-card input validation excludes internal spawned units from decks and player actions; strict record validation, portable progress backups, individual replay files, recorded names/decks, canonical red-perspective playback, final-tick commands, recorded-opponent practice and deck adoption with Undo.                                                                                                                                                                                                    |
| Friendly matches         | Confirmed lobby identities/decks, readiness reset after edits, agreed rematches, independent match IDs, stale-message rejection, authoritative deployment feedback and interrupted-client holds.                                                                                                                                                                                                                                                                                                                      |
| Graphics                 | Local input/simulation/audio holds while graphics recover; peer readiness returns only after the first successful restored draw. Manual pause remains independent and completed results remain accessible.                                                                                                                                                                                                                                                                                                            |
| Offline and installation | Native PWA icons and scope; content-hash cache reuse and duplicate-byte elimination; cached shell/asset release isolation; deliberate single-tab lobby update activation.                                                                                                                                                                                                                                                                                                                                             |
| Rendering/audio          | Native effects and music, batching, shared textures and new unit effects; retained context recovery and legacy replay presentation.                                                                                                                                                                                                                                                                                                                                                                                   |

## Replay provenance

The two histories introduced different Rage/Rocket behavior under the same replay version 5. A version number alone cannot identify their rules. The integrated `Replay.rulesFamily` field accepts `local` or `origin`:

- `local` uses the frozen engine, 30-card roster and rule data from `3a488e0`, limited to versions 1–5. Its shared combat, Freeze and Poison inputs were verified identical across the parents.
- `origin` uses the archived-roster engine and its existing version 1–18 gates. New matches and newly exported bare origin recordings carry this label explicitly.
- Old portable replay/progress wrappers were introduced only on the local line. Unmarked versions 1–5 in those wrappers migrate to `local`.
- Stored history migrates per recording only where local-only `playerName` or `opponentType` metadata proves provenance. Explicit labels always survive playback, export and backup.
- An old bare recording or stored entry without identifying metadata is inherently ambiguous. It retains the origin default; automatic migration cannot establish its source. The rules family can be supplied explicitly in its replay JSON when provenance is known. No claim is made that an unknown file can be classified perfectly.

The frozen compatibility files are deliberate historical code, not a second rules implementation to extend. Future gameplay changes belong in the current engine with explicit versioning.

## Validation record

Local integration validation is complete. Parent-line results in `QA.md` remain historical; the results below validate this integration.

Completed during integration:

- All remaining merge conflict markers resolved.
- Asset scope: 277 JSON files parse, 81 importer/fetch scripts pass syntax checks, 643 referenced file hashes match.
- The complete unit suite passes 778 tests across 136 files, including all seventeen opponent battles and replay outcomes. Type checking and root production build pass; generated cache contains 921 URLs/894 unique content groups and omits 8.1 MB of duplicate bytes at this checkpoint.
- Legacy and versioned cache upgrades reuse unchanged bytes; aliases require one download and work offline. The test waits for activation to finish before publishing another release.
- Independent original-local-engine golden replay captured at eight checkpoints through the ending, comparing complete snapshot and audio digests. Integrated local-family playback matches it.

Pages-path production smoke verification also passes: offline reload, cached match worker, battle startup, manifest/icons, scoped asset requests and all 278 native combat/death/music files.

Desktop Chromium validation passes 58 distinct production browser cases: collection/deck editing, card details and Mirror, safe update lifecycle/UI, ordinary battles, authoritative feedback, all five graphics recovery scenarios, confirmed loadouts, three friendly rounds, portable decks/progress/replays, names, recorded practice and replay controls/completion. Two reverse-role cases are intentionally skipped on desktop and run with mixed browser engines on the phone target. These are cumulative focused runs; repaired stale readiness/version assertions and the inconsistent Mirror caption were rerun successfully.

All 41 phone WebKit production checks pass, including mixed Chromium/WebKit loadouts and three-round rematches in both host roles, all five graphics recovery scenarios, touch controls, portable data, practice and deliberate offline updates. All 20 native rendering cases pass across desktop Chromium and phone WebKit: Bandit, Clone, Executioner, Lava Hound/Pups, Lightning, both Rage rule families, Rocket flight/rebuild/trails and Sparky. A duplicate fixture button and an old-scene readiness race were repaired and rerun; the rendering assertions remain intact. Reviewed desktop captures are retained with the `desktop-integrated-` prefix in `docs/screenshots`.

Final focused browser totals:

| Target           | Production cases | Native inspection cases | Total passed |
| ---------------- | ---------------: | ----------------------: | -----------: |
| Desktop Chromium |               62 |                      10 |           72 |
| Phone WebKit     |               45 |                      10 |           55 |
| Phone Chromium   |                8 |                       0 |            8 |
| **Total**        |          **115** |                  **20** |      **135** |

Both retained real-hand Rocket flows, Rage and Lightning pass on desktop and phone WebKit. CI retains both source/local Rage and Rocket test variants. Final Pages-path offline verification passes with all 278 combat/death/music files; the root-path production output is restored afterward. Build cache: 921 URLs, 894 unique content groups, 8.1 MB duplicate bytes omitted. Formatting, script syntax, staged whitespace and merge-conflict checks pass.

Peer checks used separate local browser contexts. Hosted CI, physical devices and connectivity across remote networks remain unverified. The existing WebKit-to-WebKit data-channel limitation remains documented; mixed Chromium/WebKit checks pass in both host roles.

## Historical evidence

`docs/QA.md` preserves separate validation histories for both parents. Local Rocket/Rage reconstruction records in `reference/client` describe that branch's earlier design choices; current generated inputs follow the archived-roster schemas. Both previously reviewed phone Rocket captures are retained: the local one is `phone-local-rocket-flight.png`, while `phone-rocket-flight.png` is the archived-roster capture. Neither is new visual verification of this integration.


## Subsequent AI support work

After the integration checkpoint, dedicated friendly Heal/Clone targeting replaces those two spells' generic fallback. Mirror-aware area-spell costs, deterministic full-match regressions and desktop/phone previews are recorded in the **Friendly Heal and Clone AI** checkpoint in [QA.md](QA.md). The integration validation counts above describe the merge itself; the later checkpoint passes 798 unit tests and 24 distinct browser cases.
